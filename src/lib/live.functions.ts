/**
 * Live tape — server loader. Reads canonical `events` in reverse-chronological
 * order (occurred_at DESC, block DESC, log DESC — never ingested_at), excludes
 * reorg-orphaned events (is_canonical), groups bursts via the pure live-tape
 * module, then turns each row into a human event via the conviction grammar:
 *   "John joined the YES tribe for $25 — YES is heating up, 12 joined this hour"
 * The actor is named from pov.co (alias fallback); the momentum clause comes from
 * market_state; the relationship tag ("(Twin)") is added when signed in. Multi-
 * wallet bursts read as the crowd.
 *
 * WHAT GETS IN is decided here in two passes: every row is scored, then the bar
 * is set from the distribution of that batch (src/domain/feed-density) so a
 * quiet window says something true instead of nothing at all. WHAT ORDER is
 * decided at the render boundary, because delta-sync re-sorts (see LiveTape).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { publicClient } from "@/lib/supabase-clients";
import { aliasFor } from "@/lib/wallet-identity";
import {
  flattenStory,
  groupLiveRows,
  type LiveEventInput,
  type LiveFace,
  type LiveRow,
} from "@/lib/live-tape";
import { tellConvictionStory, type ConvictionAction } from "@/domain/conviction-event";
import { scoreFeedEvent, type NetTag } from "@/domain/feed-event";
import { adaptiveFloor, admitToFeed } from "@/domain/feed-density";
import {
  scoreLiveAction,
  scoreDiscoveryMoment,
  SIGNIFICANCE,
  isCovered,
  fallbackRate,
} from "@/domain/significance";
import { familyOf, type MixCandidate } from "@/domain/feed-cadence";
import { enrichPeople, orderForViewer, relationshipBoost } from "@/domain/viewer-relationship";
import { discoveryValue, markSeen, type DiscoverySubject } from "@/domain/discovery";
import { firstBackedIsFloor } from "@/domain/tenure";
import {
  findDiscoveryMoments,
  tellDiscoveryMoment,
  type DiscoveryMoment,
} from "@/domain/discovery-moment";
import type { CachedRelationship } from "@/lib/dna/viewer-dna-cache.server";
import {
  cohortKindForViewer,
  renderCohort,
  type CohortHolder,
  type CohortKind,
  type ConvictionCohort,
  type HoldingRung,
} from "@/domain/conviction-cohort";

type NetLabel = "twin" | "tribe" | "opp" | "inverse";

/** The conviction actions the importance engine understands. */
const BELIEF_ACTIONS = new Set(["enter", "add", "reduce", "exit", "flip", "round_trip"]);

/**
 * Narrow the grammar's action to the subset the scorer weighs. `open_market`,
 * `milestone` and `surge` are not things a PERSON did to a belief, so they carry
 * no tenure meaning and are scored on their own structural terms.
 */
function beliefAction(a: ConvictionAction | undefined) {
  return a && BELIEF_ACTIONS.has(a) ? (a as "enter" | "add" | "reduce" | "exit" | "flip") : null;
}

const LIVE_KINDS = [
  "trade",
  "market_created",
  "position_changed_side",
  "believer_milestone",
  "tribe_doubled",
  "market_transition",
  "conviction_cohort",
];

/** The live feed only reports the last 72 hours. Older events are history. */
const LIVE_WINDOW_MS = 72 * 60 * 60_000;

const input = z
  .object({
    limit: z.number().int().min(1).max(300).optional(),
    wallet: z.string().min(3).optional(),
    /** Scope the tape to specific markets (center deck, position rows). */
    marketIds: z.array(z.number().int()).min(1).max(60).optional(),
    /**
     * Scope to ONE side of a market — the YES/NO rails. A side panel is asking
     * "what is happening to this belief", so market-wide rows (a market opening,
     * a transition about both sides) are deliberately excluded: the column
     * already sits inside that context and repeating it is noise.
     */
    side: z.enum(["YES", "NO"]).optional(),
    /**
     * Delta sync: only events at/after this ISO time. The client passes its
     * newest event minus an OVERLAP that exceeds every grouping window, so the
     * server re-groups the boundary exactly as a full fetch would — the client
     * then merges these fresh head rows onto its cached (immutable) tail. Omit
     * for a full fetch.
     */
    since: z.string().datetime().optional(),
  })
  .optional();

type Momentum = {
  believersYes: number | null;
  believersNo: number | null;
  newBackers1h: number | null;
  moneyYesPct: number | null;
  peopleYesPct: number | null;
  opportunityType: string | null;
};

export const listLiveEvents = createServerFn({ method: "GET" })
  .inputValidator((d: z.input<typeof input>) => input.parse(d ?? {}))
  .handler(async ({ data }) => {
    const sb = publicClient();
    const limit = data?.limit ?? 120;
    const viewer = data?.wallet?.toLowerCase() ?? null;

    const scope = data?.marketIds?.map((n) => String(n)) ?? null;
    // Scoped to specific markets == rendered inside a market panel, which already
    // shows the question and the side. Unscoped == the app-wide tape, which does not.
    const scoped = scope != null;
    let q = sb
      .from("events")
      // NOTE: the full `payload` (raw_log) is deliberately NOT selected — the raw
      // log is pure over-the-wire weight for limit*3 rows. We select only the one
      // JSON sub-field a milestone row needs (its threshold), which is tiny.
      .select(
        "source_key, kind, market_id, side, action, amount_eth, wallet, occurred_at, block_number, log_index, milestone_threshold:payload->>threshold, transition_headline:payload->>headline, transition_detail:payload->>detail",
      )
      .eq("is_canonical", true)
      .in("kind", LIVE_KINDS);
    if (scope) q = q.in("market_id", scope);
    if (data?.side) q = q.eq("side", data.side);
    // The live feed is a 72-hour window: anything older is history, not "live".
    q = q.gte("occurred_at", new Date(Date.now() - LIVE_WINDOW_MS).toISOString());
    // Delta: bound by the overlap window instead of over-reading the full list.
    // The window is small, so this fetches only what changed since last poll.
    if (data?.since) q = q.gte("occurred_at", data.since);
    const { data: rows, error } = await q
      .order("occurred_at", { ascending: false })
      .order("block_number", { ascending: false, nullsFirst: false })
      .order("log_index", { ascending: false, nullsFirst: false })
      .limit(limit * 3); // over-read so grouping still yields ~limit rows
    if (error) return { rows: [] as LiveRow[], error: error.message };

    const marketIds = [...new Set((rows ?? []).map((r) => Number(r.market_id)))];
    const titleById = new Map<number, string>();
    const momentumById = new Map<number, Momentum>();
    if (marketIds.length > 0) {
      const [mk, ms] = await Promise.all([
        sb.from("markets").select("onchain_id, title").in("onchain_id", marketIds),
        sb
          .from("market_state")
          .select(
            "onchain_id, believers_yes, believers_no, new_believers_1h, money_yes_pct, people_yes_pct, opportunity_type",
          )
          .in("onchain_id", marketIds),
      ]);
      for (const m of mk.data ?? []) titleById.set(Number(m.onchain_id), (m.title as string) ?? "");
      for (const s of ms.data ?? []) {
        const r = s as Record<string, unknown>;
        momentumById.set(Number(r.onchain_id), {
          believersYes: (r.believers_yes as number | null) ?? null,
          believersNo: (r.believers_no as number | null) ?? null,
          newBackers1h: (r.new_believers_1h as number | null) ?? null,
          moneyYesPct: (r.money_yes_pct as number | null) ?? null,
          peopleYesPct: (r.people_yes_pct as number | null) ?? null,
          opportunityType: (r.opportunity_type as string | null) ?? null,
        });
      }
    }

    // ETH/USD comes from the cron-refreshed snapshot (calc_cache), NOT the live
    // eth_usd_calibration() aggregate — that RPC scans the entire events trade
    // history joined to market_state on every load. Same value listFeed reads.
    const { data: cal } = await sb
      .from("calc_cache")
      .select("value")
      .eq("key", "eth_usd")
      .maybeSingle();
    // A zero rate is NOT a price: it is the absence of one, and pretending
    // otherwise prices every trade at $0 and empties the tape (see live-tape).
    //
    // TWO WAYS THIS GOES WRONG, and they need different fixes — which is why the
    // warning distinguishes them. `cal == null` means the row is INVISIBLE to
    // this client, not absent: calc_cache shipped with RLS on and no anon
    // policy, so the public read returned 200 with zero rows for months while
    // the stored value was perfectly fine. A present-but-null value is the other
    // case: the calibration itself returns NULL when no market has volume.
    const ethUsd = Number((cal as { value?: number } | null)?.value ?? 0) || 0;
    if (!(ethUsd > 0))
      console.warn(
        cal == null
          ? "[feed] calc_cache.eth_usd is UNREADABLE by this client (RLS/grant), so every trade is reported WITHOUT an amount. Refreshing the value will not help — check SELECT access for anon."
          : "[feed] calc_cache.eth_usd is null or zero, so every trade is reported WITHOUT an amount. Check refresh_eth_usd_calibration() and market_state.volume_total_usd.",
      );

    const events: LiveEventInput[] = (rows ?? []).map((r) => ({
      source_key: r.source_key as string,
      kind: r.kind as string,
      market_id: String(r.market_id),
      market_title: titleById.get(Number(r.market_id)) ?? null,
      occurred_at: r.occurred_at as string,
      block_number: r.block_number as number | null,
      log_index: r.log_index as number | null,
      side: (r.side as "YES" | "NO" | null) ?? null,
      action: (r.action as "BUY" | "SELL" | null) ?? null,
      amount_eth: Number(r.amount_eth ?? 0) / 1e18,
      wallet: (r.wallet as string) ?? null,
      // System milestones carry their threshold in payload so the copy can render
      // it; trades keep payload null (their raw_log was never fetched).
      payload:
        r.kind === "believer_milestone"
          ? { threshold: Number((r as Record<string, unknown>).milestone_threshold ?? 0) }
          : r.kind === "market_transition"
            ? {
                headline: ((r as Record<string, unknown>).transition_headline as string) ?? "",
                detail: ((r as Record<string, unknown>).transition_detail as string | null) ?? null,
              }
            : null,
    }));

    const live = groupLiveRows(events, ethUsd).slice(0, limit);

    // Turn each row into a story. Single-actor rows get named (pov.co, alias
    // fallback) + a relationship tag when the actor is in the viewer's network;
    // bursts read as the crowd. The momentum clause comes from market_state.
    // Resolve identity for every single-actor row AND the creator of a fresh
    // market, so attribution can name them ("Bob joined." / "@dana opened this").
    const actorWallets = [
      ...new Set(live.map((r) => r.wallet?.toLowerCase()).filter((w): w is string => !!w)),
    ];

    const labelByWallet = new Map<string, NetLabel>();
    /**
     * The viewer's relationships in full, not just their names. Discovery asks
     * how much EVIDENCE stands behind a label and how recently it was formed —
     * a 100% match on three shared markets is a coincidence, not a Twin — so the
     * feed reads the same rows the People page does instead of a thin label map.
     */
    const relByWallet = new Map<string, CachedRelationship>();
    /** Read-time, viewer-relative score bump per row. Never persisted. */
    const viewerBoost = new Map<string, number>();
    let moments: DiscoveryMoment[] = [];
    if (viewer) {
      const { serviceClient } = await import("@/lib/supabase-clients");
      const { data: cache } = await serviceClient()
        .from("viewer_dna_cache")
        .select("twin_matches, tribe_matches, opp_matches, inverse_matches")
        .eq("viewer_wallet", viewer)
        .maybeSingle();
      if (cache) {
        const add = (rows: unknown, label: NetLabel): CachedRelationship[] => {
          const out = ((rows as CachedRelationship[] | null) ?? []).filter((r) => r.wallet);
          for (const r of out) {
            const w = String(r.wallet).toLowerCase();
            labelByWallet.set(w, label);
            relByWallet.set(w, r);
          }
          return out;
        };
        const net = {
          twin: add(cache.twin_matches, "twin"),
          tribe: add(cache.tribe_matches, "tribe"),
          opp: add(cache.opp_matches, "opp"),
          inverse: add(cache.inverse_matches, "inverse"),
        };
        // MEETING SOMEONE. Read-time only, and only on the app-wide tape — a
        // market panel is about that market, not about the reader's network.
        // Nothing is written: a moment is a projection of relationships the DNA
        // engine already cached, so the same state always yields the same rows.
        if (!scoped) moments = findDiscoveryMoments(net);
      }
    }

    const profileWallets = [
      ...new Set([...actorWallets, ...moments.flatMap((m) => m.people.map((p) => p.wallet))]),
    ];
    const profiles =
      profileWallets.length > 0
        ? await import("@/lib/profiles.server").then((m) => m.resolveProfiles(profileWallets, 15))
        : new Map();

    /**
     * WHAT MAKES A MOVE MEAN SOMETHING. A sale is just a sale until you know the
     * person had believed it for 43 days, or that nothing of theirs is left. One
     * batched read over the (wallet, market) pairs already on screen turns the
     * feed from transactions into stories. Rows we can't resolve simply lose the
     * extra clause — the grammar degrades to the plain sentence, never invents.
     *
     * READ WITH THE SERVICE CLIENT, deliberately. This used the public client and
     * `wallet_beliefs` returns 401 to anon — so the map was ALWAYS empty and the
     * whole feature was silently dead: no tenure in any sentence, every sell an
     * "exit" and never a "reduce", every buy an "enter" and never an "add", and
     * the tenure terms in scoring and discovery permanently at zero. The
     * degradation was so graceful that it looked like a design choice.
     *
     * The fix is NOT to open the table to anon. `wallet_beliefs` is every
     * wallet's position book; the app publishes what it means (a sentence), not
     * a bulk-queryable table of who holds what. Every other server path already
     * reads it with the service role — this now matches them.
     */
    const beliefByKey = new Map<
      string,
      {
        daysHeld: number | null;
        tenureIsFloor: boolean;
        enteredBefore: boolean;
        yesShares: number;
        noShares: number;
      }
    >();
    if (actorWallets.length > 0 && marketIds.length > 0) {
      const { serviceClientOrNull } = await import("@/lib/supabase-clients");
      const svc = serviceClientOrNull();
      if (!svc)
        console.warn(
          "[feed] no service key — rows lose their tenure, so no story can say how long anyone believed it.",
        );
      const { data: beliefs, error: beliefErr } = svc
        ? await svc
            .from("wallet_beliefs")
            .select("wallet, onchain_id, yes_shares, no_shares, first_backed_at")
            .in("wallet", actorWallets)
            .in("onchain_id", marketIds)
            .limit(500)
        : { data: null, error: null };
      if (beliefErr)
        console.warn(
          `[feed] wallet_beliefs unreadable (${beliefErr.message}) — rows lose their tenure, so no story can say how long anyone believed it.`,
        );
      const now = Date.now();
      for (const b of (beliefs ?? []) as Array<Record<string, unknown>>) {
        const first = b.first_backed_at ? Date.parse(String(b.first_backed_at)) : NaN;
        const days = Number.isFinite(first) ? (now - first) / 86_400_000 : null;
        beliefByKey.set(`${String(b.wallet).toLowerCase()}:${Number(b.onchain_id)}`, {
          // Sub-day tenure is not a story; don't dress one up as "a day".
          daysHeld: days != null && days >= 1 ? days : null,
          // A belief that was already there when the index opened has no
          // knowable start. The sentence says "43+ days", not "43 days".
          tenureIsFloor: firstBackedIsFloor(first),
          // They were in this market before today's move.
          enteredBefore: Number.isFinite(first) && now - first > 86_400_000,
          yesShares: Number(b.yes_shares ?? 0),
          noShares: Number(b.no_shares ?? 0),
        });
      }
    }

    /** Cohort members with their tenure kept — the face stack only needs names. */
    const cohortPeople = new Map<string, CohortHolder[]>();
    /**
     * What each row did to a BELIEF, as the grammar below already worked it out.
     * Recorded rather than re-derived, so the sentence a reader sees and the
     * score that let it through can never disagree about what happened.
     */
    const actionById = new Map<string, ConvictionAction>();

    for (const r of live) {
      const w = r.wallet?.toLowerCase();
      // Name the actor / creator when we have one; tag the network relationship.
      if (w) {
        const prof = profiles.get(w);
        const relationship = labelByWallet.get(w) ?? null;
        r.face = {
          name: prof?.displayName ?? aliasFor(w),
          avatarUrl: prof?.pfpUrl ?? null,
          relationship,
        } satisfies LiveFace;
      }

      // A CONVICTION COHORT — the people still holding. The event stored PEOPLE,
      // not prose, precisely so the sentence can be written for where it is
      // being read: this request knows whether it is the app-wide tape or one
      // market's panel (`marketIds` is set only by the panel), so it strips the
      // market title and the side exactly when the surrounding UI supplies them.
      if (r.kind === "conviction_cohort") {
        const p = r.payload as unknown as {
          kind: CohortKind;
          side: "YES" | "NO";
          rung: HoldingRung;
          significance: number;
          crossedOn?: string;
          people: CohortHolder[];
        };
        const cohort: ConvictionCohort = {
          kind: p.kind,
          side: p.side,
          rung: p.rung,
          people: p.people ?? [],
          fingerprint: `cohort:${p.side}:${p.kind}:${p.rung}:${p.crossedOn ?? ""}`,
          crossedOn: p.crossedOn ?? "",
          significance: p.significance ?? 0,
        };
        // VIEWER LENS, applied here and nowhere else. The stored event is
        // universal; this labels the people against THIS reader's DNA cache and
        // leads the stack with the ones they know. Identity is untouched — same
        // row, same fingerprint, same members, same overflow count.
        const mine = enrichPeople(cohort.people, labelByWallet);
        cohort.people = orderForViewer(mine);
        cohortPeople.set(r.id, cohort.people);
        // "YOUR PEOPLE ARE HERE" is a claim about the READER, so it is decided
        // here rather than stored. The emitter has no viewer and could never
        // reach this kind — which is why the headline was unreachable until now.
        cohort.kind = cohortKindForViewer(cohort);
        const surface = scoped ? "panel" : "app";
        const story = renderCohort(cohort, surface, r.marketTitle);
        r.story = {
          category: cohort.kind === "tribe_holding" ? "tribe" : "growing",
          headline: story.headline,
          body: story.body,
          attribution: null,
          tone: p.side === "YES" ? "yes" : "no",
          personal: cohort.kind === "tribe_holding",
        };
        r.people = cohort.people;
        r.text = flattenStory(r.story);
        // Bounded, and only ever a nudge — see viewer-relationship.
        viewerBoost.set(r.id, relationshipBoost(cohort.people));
        continue;
      }

      // Market-wide transitions carry their own composed copy in the payload
      // (the emitter already ran the interpretation + dedup) — render it directly.
      if (r.kind === "market_transition") {
        const p = r.payload as { headline?: string; detail?: string | null };
        r.story = {
          category: "momentum",
          headline: "MARKET SIGNAL",
          body: p.headline ?? "",
          attribution: p.detail ?? null,
          tone: r.side === "YES" ? "yes" : r.side === "NO" ? "no" : "neutral",
          personal: false,
        };
        r.text = flattenStory(r.story);
        continue;
      }

      // Milestone / surge rows are already final from grouping (no actor to name).
      if (r.kind === "believer_milestone" || r.kind === "tribe_doubled") continue;

      const market = momentumById.get(Number(r.marketId)) ?? null;
      const buySell = (r.payload as { action?: "BUY" | "SELL" }).action ?? null;
      const actor = r.face ? { name: r.face.name, relationship: r.face.relationship } : null;
      const belief = w ? beliefByKey.get(`${w}:${Number(r.marketId)}`) : undefined;

      // WHAT THEY DID TO THEIR BELIEF, not which way the tokens went. A buy on
      // top of an existing position is an ADD (doubling down); a sell that
      // leaves nothing is an EXIT, one that leaves something is a REDUCE. The
      // read model is the state AFTER the trade, so shares==0 means they're out.
      const heldSide = r.side === "YES" ? belief?.yesShares : belief?.noShares;
      const action: ConvictionAction =
        r.kind === "market_created"
          ? "open_market"
          : r.kind === "believer_milestone"
            ? "milestone"
            : r.kind === "tribe_doubled"
              ? "surge"
              : r.kind === "side_shift"
                ? "flip"
                : r.kind === "round_trip"
                  ? "round_trip"
                  : buySell === "SELL"
                    ? heldSide != null && heldSide > 0
                      ? "reduce"
                      : "exit"
                    : belief?.enteredBefore
                      ? "add"
                      : "enter";

      actionById.set(r.id, action);

      const sideBelievers =
        r.side === "YES" ? market?.believersYes : r.side === "NO" ? market?.believersNo : null;

      r.story = tellConvictionStory({
        action,
        side: r.side,
        actor,
        context: {
          amountUsd: r.amountUsd,
          // Only claim a tenure when this row has ONE actor we actually looked up.
          daysHeld: belief?.daysHeld ?? null,
          tenureIsFloor: belief?.tenureIsFloor ?? null,
          heldBefore: belief?.enteredBefore ?? null,
          sideBelieversAfter: sideBelievers ?? null,
          peopleCount: r.walletCount,
          question: r.kind === "market_created" ? r.marketTitle : null,
          threshold:
            r.kind === "believer_milestone"
              ? Number((r.payload as { threshold?: number }).threshold ?? 0)
              : null,
        },
      });
      r.text = flattenStory(r.story);
    }

    // Materiality: the feed reports changes in conviction, not dust — "volume earns
    // attention only when it changes the meaning of the market". The importance
    // engine judges each row MARKET-RELATIVE (the same $6 is dust in a whale market
    // and a movement in a tiny one), keeping structural transitions and personal
    // (network) actions and dropping lone dust + washes (Tier 4). Order is left
    // untouched — the live tape stays chronological so delta-sync merging holds.
    // SIGNIFICANCE, DERIVED WHERE IT CANNOT BE EMITTED. A chain trade is written
    // by the indexer, which knows nothing about meaning — but the materiality
    // gate below ALREADY scores every one of them and was throwing the number
    // away, leaving the mixer to rank most of the feed on recency alone. The
    // same candidate now feeds both the gate and the score. No migration, no
    // second scoring system, nothing viewer-relative.
    // ONE CANDIDATE PER ROW, built once and used three times: to decide whether
    // the row belongs in the feed at all, to score its significance, and to set
    // the bar the whole batch is judged against.
    //
    // The candidate now carries WHAT THE MOVE DID TO A BELIEF — added, reduced,
    // exited, flipped, and how long it had been held — not just how much it
    // cost. Judged on dollars alone this feed reported capital and missed the
    // only thing it is about: a $12 exit after three months is a story, and a
    // $200 entry by someone who arrived this morning often is not.
    const scored = live.map((r) => {
      const m = momentumById.get(Number(r.marketId));
      const marketBelievers = m ? (m.believersYes ?? 0) + (m.believersNo ?? 0) : null;
      const b = r.wallet
        ? beliefByKey.get(`${r.wallet.toLowerCase()}:${Number(r.marketId)}`)
        : null;
      const heldSide = r.side === "YES" ? b?.yesShares : b?.noShares;
      const sell = (r.payload as { action?: string }).action === "SELL";
      const fullExit = sell && heldSide != null && heldSide <= 0;
      const conviction = beliefAction(actionById.get(r.id));
      const candidate = {
        kind: r.kind,
        side: r.side,
        amountUsd: r.amountUsd,
        walletCount: r.walletCount,
        tradeCount: r.tradeCount,
        windowMs: Number((r.payload as { window_ms?: number }).window_ms ?? 0) || null,
        relationship: (r.face?.relationship as NetTag | null) ?? null,
        marketBelievers,
        conviction,
        daysHeld: b?.daysHeld ?? null,
      };
      return { r, candidate, fullExit, daysHeld: b?.daysHeld ?? null };
    });

    // ADAPTIVE DENSITY. The gate above is absolute — "is this big?" — and on a
    // quiet chain the honest answer is no for everything, which is how a live
    // market renders as two rows. The editorial question is "is this the biggest
    // thing that happened today?", so the bar comes from the distribution of
    // what actually exists. On a busy day this changes nothing; on a quiet one
    // the small true things get to speak. Washes and dust never return.
    const { floor, relaxed } = adaptiveFloor(
      scored.map(({ candidate }) => scoreFeedEvent(candidate).score),
    );

    const derived = new Map<string, number>();
    const material = scored
      .filter(({ candidate }) => admitToFeed(candidate, floor))
      .map(({ r, candidate, fullExit, daysHeld }) => {
        derived.set(r.id, scoreLiveAction(candidate, { daysHeld, fullExit }).score);
        return r;
      });

    // ── DISCOVERY: "is there someone here I should meet?" ────────────────────
    // The second ranking dimension, and the one the product is actually for.
    // Significance says how big an event is; this says whether it opens a
    // relationship. Both are needed: a $5,000 anonymous trade really is the
    // bigger event, and a $50 buy by your Twin really is the better row.
    //
    // Walked in chronological order so `seen` is deterministic — the reader's
    // eventual order comes from the mixer, which cannot be an input to its own
    // inputs, so "most recent appearance is the first one" is the honest proxy.
    const discovery = new Map<string, number>();
    const seen = new Map<string, number>();
    const subjectsFor = (r: (typeof material)[number]): DiscoverySubject[] => {
      const group = cohortPeople.get(r.id);
      const wallets = group?.length ? group.map((p) => p.wallet) : r.wallet ? [r.wallet] : [];
      const founding =
        r.kind === "conviction_cohort" && (r.payload as { kind?: string }).kind === "founding";
      return wallets.map((raw) => {
        const w = raw.toLowerCase();
        const rel = relByWallet.get(w);
        const held = group?.find((p) => p.wallet.toLowerCase() === w)?.daysHeld;
        return {
          wallet: w,
          relationship: labelByWallet.get(w) ?? null,
          sharedConvictions: rel?.sharedBeliefs ?? null,
          confidence: rel?.confidence ?? null,
          topicCount: rel?.topicCount ?? null,
          since: rel?.since ?? null,
          daysHeld: held ?? beliefByKey.get(`${w}:${Number(r.marketId)}`)?.daysHeld ?? null,
          founding,
        } satisfies DiscoverySubject;
      });
    };
    for (const r of material) {
      const subs = subjectsFor(r);
      discovery.set(r.id, discoveryValue(subs, { seen }).score);
      markSeen(
        seen,
        subs.map((s) => s.wallet),
      );
    }

    // ── MEETING SOMEONE ──────────────────────────────────────────────────────
    // The rarest rows in the feed, and the only ones not about a market. They
    // are synthesized here rather than stored because they exist for exactly one
    // reader — see src/domain/discovery-moment for why that needs no ledger.
    for (const m of moments) {
      // Name the people first: the copy speaks about them, and the DNA cache
      // stores wallets, not names. `aliasFor` is the last resort so a row never
      // shows a hex address where a person should be.
      const named = m.people.map((p) => {
        const prof = profiles.get(p.wallet.toLowerCase());
        return { ...p, name: prof?.displayName ?? aliasFor(p.wallet) };
      });
      const story = tellDiscoveryMoment({ ...m, people: named });
      const lead = named[0];
      const significance = scoreDiscoveryMoment({
        rarity: m.rarity,
        sharedConvictions: lead?.sharedBeliefs ?? null,
        people: named.length,
      }).score;
      const subs: DiscoverySubject[] = named.map((p) => ({
        wallet: p.wallet.toLowerCase(),
        relationship:
          p.relationship === "neutral" || p.relationship === "insufficient" ? null : p.relationship,
        sharedConvictions: p.sharedBeliefs,
        confidence: p.confidence,
        topicCount: p.topicCount ?? null,
        since: p.since ?? null,
      }));
      const row: LiveRow = {
        id: m.id,
        kind: "discovery_moment",
        // Not about a market. The renderer treats a non-positive id as "no
        // destination" and lets the faces be the only way in — which is what
        // this row is for.
        marketId: "0",
        marketTitle: "",
        occurredAt: m.occurredAt,
        startedAt: m.occurredAt,
        side: null,
        walletCount: named.length,
        tradeCount: null,
        amountEth: null,
        amountUsd: null,
        wallet: null,
        people: named.map((p) => ({
          wallet: p.wallet,
          name: p.name,
          avatarUrl: profiles.get(p.wallet.toLowerCase())?.pfpUrl ?? null,
        })),
        story,
        text: flattenStory(story),
        payload: { significance },
        mix: {
          id: m.id,
          family: "relationship_story",
          significance,
          discovery: discoveryValue(subs, { seen }).score,
          occurredAt: m.occurredAt,
          marketId: "0",
          side: null,
          subjects: subs.map((s) => s.wallet),
          motif: `discovery:${m.kind}`,
        },
      };
      material.unshift(row);
      markSeen(
        seen,
        subs.map((s) => s.wallet),
      );
    }

    // MIXER INPUTS, not the mix itself. The server is where significance, the
    // viewer's relationships and the event families live, so it computes them —
    // but it must NOT reorder here. Delta-sync merges the fresh head into the
    // client's cached tail and re-sorts chronologically (mergeLiveRows), which
    // would throw a server-side ordering away on every poll. So the ordering is
    // applied once, after the merge, at the render boundary. One mixer, one
    // implementation, applied where the final order actually lives.
    for (const r of material) {
      if (r.kind === "discovery_moment") continue; // already carries its own inputs
      r.mix = {
        id: r.id,
        family: familyOf({ kind: r.kind, personal: r.story.personal }),
        discovery: discovery.get(r.id) ?? 0,
        // Emitted (our own emitters persist it) → derived (scored just above)
        // → fallback, which is now only reachable by a legacy or unknown kind.
        significance: Math.min(
          1,
          (typeof (r.payload as { significance?: number }).significance === "number"
            ? (r.payload as { significance: number }).significance
            : (derived.get(r.id) ?? SIGNIFICANCE.fallback)) + (viewerBoost.get(r.id) ?? 0),
        ),
        occurredAt: r.occurredAt,
        marketId: String(r.marketId),
        side: r.side,
        subjects: r.people?.length
          ? r.people.map((x) => x.wallet)
          : r.wallet
            ? [r.wallet.toLowerCase()]
            : [],
        motif: `${r.kind}:${r.side ?? "market"}:${r.story.headline}`,
      } satisfies MixCandidate;
    }

    // Telemetry: how much of this feed is still guessing? A new LIVE_KIND that
    // ships without a scorer shows up here instead of silently ranking at 0.5.
    if (import.meta.env.DEV) {
      if (relaxed)
        console.info(
          `[feed] quiet window: bar relaxed to ${floor} (standard 25) — ${material.length}/${scored.length} rows admitted.`,
        );
      const uncovered = [...new Set(material.map((r) => r.kind).filter((k) => !isCovered(k)))];
      if (uncovered.length)
        console.warn(
          `[feed] kind(s) with no entry in SIGNIFICANCE_COVERAGE: ${uncovered.join(", ")} — add a scorer or they rank at the fallback forever.`,
        );
      const t = fallbackRate(
        material.map((r) => ({
          kind: r.kind,
          significance:
            typeof (r.payload as { significance?: number }).significance === "number"
              ? (r.payload as { significance: number }).significance
              : (derived.get(r.id) ?? null),
        })),
      );
      if (t.fallback > 0)
        console.warn(
          `[feed] ${t.fallback}/${t.total} rows (${Math.round(t.rate * 100)}%) fell back to a default significance. Unscored kinds: ${t.kinds.join(", ")}`,
        );
    }

    return { rows: material, error: null };
  });
