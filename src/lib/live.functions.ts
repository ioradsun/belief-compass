/**
 * Live tape — server loader. Reads canonical `events` in reverse-chronological
 * order (occurred_at DESC, block DESC, log DESC — never ingested_at), excludes
 * reorg-orphaned events (is_canonical), groups bursts via the pure live-tape
 * module, then turns each row into a human event via the conviction grammar:
 *   "John joined the YES tribe for $25 — YES is heating up, 12 joined this hour"
 * The actor is named from pov.co (alias fallback); the momentum clause comes from
 * market_state; the relationship tag ("(Twin)") is added when signed in. Multi-
 * wallet bursts read as the crowd. Live answers "what just happened?" — never ranked.
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
import { includeInFeed, type NetTag } from "@/domain/feed-event";
import { scoreLiveAction, SIGNIFICANCE, isCovered, fallbackRate } from "@/domain/significance";
import { familyOf, type MixCandidate } from "@/domain/feed-cadence";
import { enrichPeople, orderForViewer, relationshipBoost } from "@/domain/viewer-relationship";
import {
  renderCohort,
  type CohortHolder,
  type CohortKind,
  type ConvictionCohort,
  type HoldingRung,
} from "@/domain/conviction-cohort";

type NetLabel = "twin" | "tribe" | "opp" | "inverse";

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
    const ethUsd = Number((cal as { value?: number } | null)?.value ?? 0) || 0;

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
    /** Read-time, viewer-relative score bump per row. Never persisted. */
    const viewerBoost = new Map<string, number>();
    if (viewer && actorWallets.length > 0) {
      const { serviceClient } = await import("@/lib/supabase-clients");
      const { data: cache } = await serviceClient()
        .from("viewer_dna_cache")
        .select("twin_matches, tribe_matches, opp_matches, inverse_matches")
        .eq("viewer_wallet", viewer)
        .maybeSingle();
      if (cache) {
        const add = (rows: unknown, label: NetLabel) => {
          for (const r of (rows as { wallet?: string }[] | null) ?? [])
            if (r.wallet) labelByWallet.set(String(r.wallet).toLowerCase(), label);
        };
        add(cache.twin_matches, "twin");
        add(cache.tribe_matches, "tribe");
        add(cache.opp_matches, "opp");
        add(cache.inverse_matches, "inverse");
      }
    }

    const profiles =
      actorWallets.length > 0
        ? await import("@/lib/profiles.server").then((m) => m.resolveProfiles(actorWallets, 15))
        : new Map();

    /**
     * WHAT MAKES A MOVE MEAN SOMETHING. A sale is just a sale until you know the
     * person had believed it for 43 days, or that nothing of theirs is left. One
     * batched read over the (wallet, market) pairs already on screen turns the
     * feed from transactions into stories. Rows we can't resolve simply lose the
     * extra clause — the grammar degrades to the plain sentence, never invents.
     */
    const beliefByKey = new Map<
      string,
      { daysHeld: number | null; enteredBefore: boolean; yesShares: number; noShares: number }
    >();
    if (actorWallets.length > 0 && marketIds.length > 0) {
      const { data: beliefs } = await sb
        .from("wallet_beliefs")
        .select("wallet, onchain_id, yes_shares, no_shares, first_backed_at")
        .in("wallet", actorWallets)
        .in("onchain_id", marketIds)
        .limit(500);
      const now = Date.now();
      for (const b of (beliefs ?? []) as Array<Record<string, unknown>>) {
        const first = b.first_backed_at ? Date.parse(String(b.first_backed_at)) : NaN;
        const days = Number.isFinite(first) ? (now - first) / 86_400_000 : null;
        beliefByKey.set(`${String(b.wallet).toLowerCase()}:${Number(b.onchain_id)}`, {
          // Sub-day tenure is not a story; don't dress one up as "a day".
          daysHeld: days != null && days >= 1 ? days : null,
          // They were in this market before today's move.
          enteredBefore: Number.isFinite(first) && now - first > 86_400_000,
          yesShares: Number(b.yes_shares ?? 0),
          noShares: Number(b.no_shares ?? 0),
        });
      }
    }

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
          people: CohortHolder[];
        };
        const cohort: ConvictionCohort = {
          kind: p.kind,
          side: p.side,
          rung: p.rung,
          people: p.people ?? [],
          fingerprint: `cohort:${p.side}:${p.kind}:${p.rung}`,
          significance: p.significance ?? 0,
        };
        // VIEWER LENS, applied here and nowhere else. The stored event is
        // universal; this labels the people against THIS reader's DNA cache and
        // leads the stack with the ones they know. Identity is untouched — same
        // row, same fingerprint, same members, same overflow count.
        const mine = enrichPeople(cohort.people, labelByWallet);
        cohort.people = orderForViewer(mine);
        const surface = scoped ? "panel" : "app";
        const story = renderCohort(cohort, surface, r.marketTitle);
        r.story = {
          category: p.kind === "tribe_holding" ? "tribe" : "growing",
          headline: story.headline,
          body: story.body,
          attribution: null,
          tone: p.side === "YES" ? "yes" : "no",
          personal: p.kind === "tribe_holding",
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
    const derived = new Map<string, number>();
    const material = live.filter((r) => {
      const m = momentumById.get(Number(r.marketId));
      const marketBelievers = m ? (m.believersYes ?? 0) + (m.believersNo ?? 0) : null;
      const candidate = {
        kind: r.kind,
        side: r.side,
        amountUsd: r.amountUsd,
        walletCount: r.walletCount,
        tradeCount: r.tradeCount,
        windowMs: Number((r.payload as { window_ms?: number }).window_ms ?? 0) || null,
        relationship: (r.face?.relationship as NetTag | null) ?? null,
        marketBelievers,
      };
      if (!includeInFeed(candidate)) return false;
      const b = r.wallet
        ? beliefByKey.get(`${r.wallet.toLowerCase()}:${Number(r.marketId)}`)
        : null;
      const heldSide = r.side === "YES" ? b?.yesShares : b?.noShares;
      derived.set(
        r.id,
        scoreLiveAction(candidate, {
          daysHeld: b?.daysHeld ?? null,
          // Nothing of theirs left on this side → they are out, not trimming.
          fullExit:
            (r.payload as { action?: string }).action === "SELL" &&
            heldSide != null &&
            heldSide <= 0,
        }).score,
      );
      return true;
    });

    // MIXER INPUTS, not the mix itself. The server is where significance, the
    // viewer's relationships and the event families live, so it computes them —
    // but it must NOT reorder here. Delta-sync merges the fresh head into the
    // client's cached tail and re-sorts chronologically (mergeLiveRows), which
    // would throw a server-side ordering away on every poll. So the ordering is
    // applied once, after the merge, at the render boundary. One mixer, one
    // implementation, applied where the final order actually lives.
    for (const r of material) {
      r.mix = {
        id: r.id,
        family: familyOf({ kind: r.kind, personal: r.story.personal }),
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
