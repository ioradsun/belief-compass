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
import { serviceClient } from "@/lib/supabase-clients";
import { peekSwr, swrCache } from "@/lib/server-cache";

import { aliasFor } from "@/lib/wallet-identity";
import { showedUpInMarket } from "@/domain/dependability";
import {
  flattenStory,
  groupLiveRows,
  type LiveEventInput,
  type LiveRow,
} from "@/lib/live-tape";
import type { ConvictionAction } from "@/domain/conviction-event";
import { voiceLevel, applyViewerAngle } from "@/domain/pi-voice";
import {
  piQuestion,
  questionAdds,
  questionBudget,
  rationQuestions,
  SEMANTIC_GAIN,

  type QuestionKind,
} from "@/domain/pi-question";
import { composeClues, type ComposedClue } from "@/domain/composed-clue";
import {
  capVoice,
  RECEIPT_SIGNIFICANCE_CEILING,
  type CopyLevel,
} from "@/domain/transition-denominator";
import type { NetTag } from "@/domain/feed-event";
import { runNarrationPass } from "@/lib/insider/composition/narration-pass";
import {
  buildCandidates,
  candidateMarkets,
  runSignificancePass,
} from "@/lib/insider/composition/significance-pass";
import { SIGNIFICANCE, isCovered, fallbackRate } from "@/domain/significance";
import { familyOf, VOICE_CEILING, type MixCandidate } from "@/domain/feed-cadence";
import { signalVector } from "@/domain/signal-vector";
import { COPY_VERSION } from "@/domain/copy-version";
import {
  ONE_SIDED_MIN_DAYS,
  LOPSIDED_MIN_LEAD_USD,
  LOPSIDED_RATIO,
  type SemanticInput,
} from "@/domain/semantic-question";
import { factsForRow } from "@/domain/signal-facts";
import { groupPricePaths, type PriceSample } from "@/domain/price-proof";
import { editFeed, secondSentenceAdds } from "@/domain/feed-editorial";
import { findPersonPatterns } from "@/domain/person-pattern";

import { stakeBoost, NO_STAKES } from "@/domain/viewer-stake";
import { currentHoldDays, holdStartIsFloor } from "@/domain/tenure";
import { classifyPace } from "@/domain/feed-scheduler";
import { buildStandingStories } from "@/lib/standing-facts.server";
import { buildPersonMilestones } from "@/lib/person-milestones.server";
import { tellConvictionMilestone } from "@/domain/person-milestone";

import {
  findDiscoveryMoments,
  type DiscoveryMoment,
} from "@/domain/discovery-moment";
import { viewerNetwork } from "@/domain/viewer-network";
import type { ProfileLike } from "@/domain/feed-people";
import type { CachedRelationship } from "@/lib/dna/viewer-dna-cache.server";
import { weiToEth } from "@/domain/money";
import type { CohortHolder } from "@/domain/conviction-cohort";
import { fetchMarketNames } from "@/lib/market-titles.server";
import { tapeInput } from "@/lib/insider/tape-input";
import { runDiscoveryPass } from "@/lib/insider/composition/discovery-pass";
import {
  LIVE_WINDOW_MS,
  loadPricePaths,
  REAL_DEPS,
  type Momentum,
  type TapeDeps,
} from "@/lib/insider/source.server";

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

/**
 * Market-wide story types that are moments rather than reports.
 *
 * The story engine (src/domain/story-event) already names what it noticed and
 * the emitter persists that name in the payload. A side doubling, a crowd
 * crossing a round number, a Tribe forming — these are the community growing,
 * and they belong beside the personal celebrations rather than beside a decline.
 * `losing_conviction` and `material_move` deliberately are not here: a fall and
 * a five-percent move are news, not causes for celebration.
 */
const CELEBRATION_TRANSITIONS = new Set([
  "side_doubled",
  "believer_milestone",
  "capital_milestone",
  "market_reawakened",
  "tribe_forming",
  "participation_broadening",
  "market_dividing",
]);



const input = tapeInput;



/**
 * How many standing stories one full fetch may offer the pipeline.
 *
 * This is a CANDIDATE ceiling, not a reserve depth. Standing stories now
 * compete for the window on significance like everything else, so the number
 * only has to be large enough that the editorial layer has a real choice — the
 * ranking, family caps and cooldowns do the rest of the work that a fixed
 * reserve size used to do badly. It stays cheap: one wallet_beliefs read the
 * tape already needs.
 */
const STANDING_CANDIDATES = 18;


/** How far back an answered call can be and still be news. */
const SHOWED_UP_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
/** Rows per fetch. Already one per market, so this is a second, gentler cap. */
const SHOWED_UP_MAX = 4;

/**
 * THE SHARED TAPE IS ONE ANSWER, NOT ONE PER READER.
 *
 * The unscoped, signed-out tape is identical for every visitor, and building it
 * is several reads plus the whole grammar pass. Cached under one key it is
 * built once per window and handed to everyone else — which is what lets SSR
 * peek at it (see `getWarmTape`) and the phone paint "Now" on arrival instead of
 * waiting a round trip for it.
 *
 * A wallet, a market scope, a side or a delta `since` is a DIFFERENT question
 * and never touches this cache.
 */
export const TAPE_KEY = "tape:anon";
const TAPE_TTL_MS = 10_000;

function isSharedTape(data: z.output<typeof input>): boolean {
  return !data?.wallet && !data?.marketIds?.length && !data?.side && !data?.since;
}

export const listLiveEvents = createServerFn({ method: "GET" })
  .inputValidator((d: z.input<typeof input>) => input.parse(d ?? {}))
  .handler(async ({ data }) => {
    if (!isSharedTape(data)) return buildTape(data);
    return swrCache(`${TAPE_KEY}:${data?.limit ?? 120}`, { ttlMs: TAPE_TTL_MS }, () =>
      buildTape(data),
    );
  });

/**
 * The SSR read: this isolate's warm tape, or null. NEVER builds — a shell that
 * waits on the tape is the stall this whole path exists to remove.
 */
export const getWarmTape = createServerFn({ method: "GET" }).handler(async () => {
  return peekSwr<Awaited<ReturnType<typeof buildTape>>>(`${TAPE_KEY}:120`) ?? null;
});


export async function buildTape(data: z.output<typeof input>, deps: TapeDeps = REAL_DEPS) {
  const sb = deps.client();
  const limit = data?.limit ?? 120;
  const viewer = data?.wallet?.toLowerCase() ?? null;

  const scope = data?.marketIds?.map((n) => String(n)) ?? null;
  // Scoped to specific markets == rendered inside a market panel, which already
  // shows the question and the side. Unscoped == the app-wide tape, which does not.
  const scoped = scope != null;
  const source = await deps.loadTapeSource(sb, data);
  if (source.error)
    return {
      rows: [] as LiveRow[],
      copyVersion: COPY_VERSION,
      error: source.error,
    };

  const { rows, marketIds, titleById, creatorByMarket, momentumById, ethUsd } = source;

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
    amount_eth: weiToEth(r.amount_eth as string | null),
    wallet: (r.wallet as string) ?? null,
    // System milestones carry their threshold in payload so the copy can render
    // it; trades keep payload null (their raw_log was never fetched).
    payload:
      r.kind === "believer_milestone"
        ? { threshold: Number((r as Record<string, unknown>).milestone_threshold ?? 0) }
        : r.kind === "conviction_cohort"
          ? {
              kind: ((r as Record<string, unknown>).cohort_kind as string) ?? null,
              side: (r.side as string | null) ?? null,
              rung: (() => {
                const v = Number((r as Record<string, unknown>).cohort_rung);
                return Number.isFinite(v) ? v : null;
              })(),
              crossedOn:
                ((r as Record<string, unknown>).cohort_crossed_on as string | null) ?? null,
              people: Array.isArray((r as Record<string, unknown>).cohort_people)
                ? ((r as Record<string, unknown>).cohort_people as unknown[])
                : [],
              significance: (() => {
                const v = Number((r as Record<string, unknown>).transition_significance);
                return Number.isFinite(v) ? v : undefined;
              })(),
            }
          : r.kind === "market_transition"
            ? {
                headline: ((r as Record<string, unknown>).transition_headline as string) ?? "",
                detail: ((r as Record<string, unknown>).transition_detail as string | null) ?? null,
                type: ((r as Record<string, unknown>).transition_type as string | null) ?? null,
                // Stored as text by `payload->>`; a malformed value stays absent
                // so the mixer falls back rather than ranking on a NaN.
                significance: (() => {
                  const v = Number((r as Record<string, unknown>).transition_significance);
                  return Number.isFinite(v) ? v : undefined;
                })(),
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

  /**
   * THE CROWD HAS FACES TOO. A burst row carries the wallets behind it (see
   * live-tape) with what each committed, so "6 people backed YES" can be six
   * clickable people instead of a number.
   */
  type BurstStake = { wallet: string; usd: number | null };
  const burstStakes = new Map<string, BurstStake[]>();
  for (const r of live) {
    const raw = (r.payload as { wallets?: BurstStake[] }).wallets;
    if (!Array.isArray(raw) || raw.length === 0) continue;
    const list = raw
      .filter((s) => s && typeof s.wallet === "string")
      .map((s) => ({ wallet: s.wallet.toLowerCase(), usd: s.usd ?? null }));
    if (list.length > 0) burstStakes.set(r.id, list);
  }

  /**
   * A MARKET SIGNAL HAS PEOPLE TOO. "Believers in YES doubled" is a statement
   * about a crowd, but the crowd was invisible: these rows carry no wallet and
   * no burst payload, so they were the only rows in the feed with nothing to
   * tap. The believers ARE the story, so we borrow the market's largest
   * current holders (a few faces, not a directory) and let the reader in.
   */
  const signalMarkets = [
    ...new Set(
      live
        .filter((r) => !r.wallet && !burstStakes.has(r.id) && Number.isFinite(Number(r.marketId)))
        .map((r) => Number(r.marketId)),
    ),
  ];
  /** marketId → believer wallets, biggest position first. */
  const believersByMarket = await deps.loadBelieverFaces(sb, signalMarkets);

  const labelByWallet = new Map<string, NetLabel>();
  /**
   * The viewer's relationships in full, not just their names. Discovery asks
   * how much EVIDENCE stands behind a label and how recently it was formed —
   * a 100% match on three shared markets is a coincidence, not a Twin — so the
   * feed reads the same rows the People page does instead of a thin label map.
   */
  const relByWallet = new Map<string, CachedRelationship>();
  /**
   * Read-time, viewer-relative score bump per row. Never persisted.
   *
   * This existed and was populated for ONE row kind (conviction cohorts), so
   * a market transition in the question you created, a celebration in the
   * market you are holding, and an anonymous trade in a market you have never
   * seen were ranked identically. See src/domain/viewer-stake.
   */
  const viewerBoost = new Map<string, number>();
  let moments: DiscoveryMoment[] = [];
  if (viewer) {
    const net = viewerNetwork(await deps.loadViewerDna(viewer), scoped);
    for (const [w, l] of net.labelByWallet) labelByWallet.set(w, l);
    for (const [w, r] of net.relByWallet) relByWallet.set(w, r);
    moments = net.moments;
  }

  const profileWallets = [
    ...new Set([
      ...actorWallets,
      ...moments.flatMap((m) => m.people.map((p) => p.wallet)),
      ...[...burstStakes.values()].flatMap((l) => l.map((s) => s.wallet)),
      ...[...believersByMarket.values()].flat(),
    ]),
  ];

  const profiles =
    profileWallets.length > 0 ? await deps.resolveProfiles(profileWallets, 15) : new Map();

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
  const beliefByKey = await deps.loadActorBeliefs(sb, actorWallets, marketIds);

  /* THE NARRATION PASS. Facts in, sentences out — see
     insider/composition/narration-pass. It mutates the rows (face, people,
     story, text) and hands back the per-row judgements the ranking, editorial
     and question layers read below. */
  const {
    cohortPeople,
    actionById,
    celebrationById,
    unrenderable,
    copyLevel,
    copySuppressed,
    voiceFloor,
  } = runNarrationPass({
    live,
    profiles,
    labelByWallet,
    believersByMarket,
    burstStakes,
    beliefByKey,
    momentumById,
    scoped,
    viewerBoost,
  });

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
  const scored = buildCandidates({
    live,
    unrenderable,
    momentumById,
    beliefByKey,
    actionById,
  });

  /* TEMPORAL PROOF. One bounded read — hourly price observations for just the
     markets with a candidate row — is what licenses "since then". Without it the
     vector can only ever say `new`, which is the correct silence rather than a
     guess. It sits between the two halves of the significance pass because the
     markets to read are only known once the candidates exist. */
  const pricePaths = await loadPricePaths(sb, candidateMarkets(scored));
  /* One clock for the whole pass, shared with the standing rows composed below
     so both halves of the feed measure age against the same instant. */
  const signalNowMs = Date.now();

  const {
    floor,
    relaxed,
    pulseBar,
    signalById,
    standingKindById,
    derived,
    tierById,
    pulseIds,
    material,
    unadmitted,
  } = runSignificancePass({ scored, momentumById, pricePaths, nowMs: signalNowMs });

  /* ── STANDING IS A STORY TYPE, NOT A LANE ──────────────────────────────────
     Persistence enters the SAME pool as change, at the SAME point, and earns
     its place the same way. Every row below this line — significance, viewer
     angle, editorial subtraction, person patterns, composed clues, the
     question layer — treats these exactly like an event story.

     The old design returned them on a separate `standing` channel and had the
     client drip-feed them during silence. That made the product's best
     observation — "the price fell nine points and not one of them moved" —
     structurally unrankable: it could only ever appear when NOTHING was
     happening, which is precisely when it means least. Contrast needs
     something to contrast with.

     They are `timeless: true` rather than backdated: a standing story is not
     an event that occurred at a moment, and inventing an `occurredAt` would be
     inventing history. See src/domain/standing-story.

     Full fetches only — a delta poll merges into a tail that already carries
     them, and nobody's tenure changes in thirty seconds. */
  if (data?.since == null && marketIds.length > 0) {
    // PROVEN departures only, counted from the events this window actually
    // loaded. "Fewer holders than yesterday" would be an inference; a row that
    // says someone left is a receipt.
    const exitsByKey = new Map<string, number>();
    for (const { r } of scored) {
      const act = actionById.get(r.id);
      if (act !== "exit" && act !== "flip") continue;
      const k = `${Number(r.marketId)}:${r.side}`;
      exitsByKey.set(k, (exitsByKey.get(k) ?? 0) + 1);
    }

    const standingRows = await buildStandingStories({
      marketIds,
      labelByWallet,
      crossingsByWallet: new Map([...relByWallet].map(([w, r]) => [w, r.sharedBeliefs ?? 0])),
      titleById,
      evidenceByMarket: new Map(
        [...momentumById].map(([id, m]) => [
          id,
          {
            yesPriceChange24h: m.yesPriceChange24h,
            yesCapitalDelta24h: m.yesCapitalDelta24h,
            noCapitalDelta24h: m.noCapitalDelta24h,
            believersYes: m.believersYes,
            believersNo: m.believersNo,
            marketAgeDays: m.marketAgeDays,
          },
        ]),
      ),
      exitsByKey,
      now: signalNowMs,
      limit: STANDING_CANDIDATES,
    }).catch(() => []);

    for (const s of standingRows) {
      // A YES/NO activity rail is a side ledger. Standing stories are built
      // from the whole market, so the same side boundary applies or a quiet
      // YES rail fills with NO continuity.
      if (data?.side && s.side !== data.side) continue;
      const id = `standing:${s.key}`;
      /* TWO KINDS, NOT FIVE. The pipeline's kind is the CLASS — every mapping
         downstream (family caps, pace, the social-vector set, the renderer)
         only ever needs to know "receipt or something with a market fact in
         it". The specific shape travels in `motif` and in `standingKindById`,
         where the mixer's variety caps and the question layer read it. */
      const kind = s.klass === "receipt" ? "standing_fact" : "standing_signal";
      standingKindById.set(id, { kind: s.kind, klass: s.klass });
      /* A standing story is "about you" when one of the people standing there
         is someone the reader knows — not because it is a standing story. */
      const personal = s.people.some((p) => p.relationship != null);



      /* INTELLIGENCE EARNS A REAL VECTOR; A RECEIPT DOES NOT.
         `standing_signal` is absent from SOCIAL_SIGNAL_KINDS precisely so it
         reads live market facts here — the contrast IS the market's own
         movement, so a zero vector would have thrown away the whole point.
         `standing_fact` stays social and zero, which is the honest score for
         "someone is still here" with nothing to contrast it against. */
      const m = momentumById.get(s.marketId);
      signalById.set(
        id,
        signalVector(
          factsForRow(
            { kind, wallet: null, action: null, amountUsd: null, occurredAt: null },
            m
              ? {
                  yesPrice: m.yesPrice,
                  yesPriceChange1h: m.yesPriceChange1h,
                  yesPriceChange24h: m.yesPriceChange24h,
                  yesPriceChange7d: m.yesPriceChange7d,
                  yesCapitalDelta24h: m.yesCapitalDelta24h,
                  noCapitalDelta24h: m.noCapitalDelta24h,
                  capitalHeldYes: m.capitalHeldYes,
                  capitalHeldNo: m.capitalHeldNo,
                  tradeCount24h: m.tradeCount24h,
                  tradeCount7d: m.tradeCount7d,
                  believersYes: m.believersYes,
                  believersNo: m.believersNo,
                  newBelievers24h: m.newBelievers24h,
                  newBelieversYes24h: m.newBelieversYes24h,
                  newBelieversNo24h: m.newBelieversNo24h,
                  peopleYesChange24h: m.peopleYesChange24h,
                  sideFlips24h: m.sideFlips24h,
                  lastTradeAt: m.lastTradeAt,
                }
              : null,
            signalNowMs,
            null,
          ),
        ),
      );
      derived.set(id, s.strength);
      tierById.set(id, s.strength >= 0.65 ? 1 : 2);

      material.push({
        id,
        kind,
        marketId: String(s.marketId),
        marketTitle: s.marketTitle,
        // No "when", and none invented. `timeless` stops the renderer printing
        // an age that would read as "this just happened".
        occurredAt: new Date(0).toISOString(),
        startedAt: new Date(0).toISOString(),
        timeless: true,
        side: s.side,
        walletCount: s.people.length,
        tradeCount: null,
        amountEth: null,
        amountUsd: null,
        wallet: null,
        people: s.people.map((p) => ({
          wallet: p.wallet,
          name: p.name,
          avatarUrl: p.avatarUrl,
        })),
        story: {
          category: "conviction",
          headline: s.headline,
          body: s.body,
          attribution: null,
          tone: "neutral",
          personal,
        },
        text: `${s.headline} — ${s.body}`,
        // Not urgent and not stale: it was true an hour ago and will be true in
        // an hour, so it must never preempt a market moving right now.
        pace: { perishability: "soon", weight: s.strength >= 0.65 ? 2 : 3 },
        /* The SHAPE, not the sentence, is what the reader experiences as a
           repeat — "held through the move" twice is a repeat even when the
           day counts differ, so the motif keys on the shape the domain named
           and never on the composed copy. */
        payload: { significance: s.strength, motif: s.motif, standingKind: s.kind },

      } as (typeof material)[number]);
    }
  }


  // ── YOUR OWN STAKE ───────────────────────────────────────────────────────
  // The ranker knew about PEOPLE the reader is connected to and nothing about
  // their own MARKETS: a transition in the question you opened was ranked
  // exactly like one in a market you have never seen. The mechanism existed —
  // `viewerBoost` — and was populated for a single row kind.
  //
  // Bounded by the same ceiling relationship personalization uses, so the two
  // axes cannot outbid each other, and neither can lift a dust trade into the
  // breaking band. See src/domain/viewer-stake.
  let stakes = NO_STAKES;
  if (viewer && marketIds.length > 0) {
    const created = new Set<number>();
    for (const [id, w] of creatorByMarket) if (w === viewer) created.add(id);
    const holding = await deps.loadViewerHoldings(viewer, marketIds);
    stakes = { created, holding };
  }

  // ── PERSON MILESTONES: the second story one action tells ────────────────
  // Every other family reports what happened to a MARKET. "Sarah backed AI"
  // and "AI gained a new believer" are both here; "Sarah now backs five
  // questions" was not, and it is the one that makes a reader feel they are
  // watching people rather than transactions.
  //
  // Read-time, no table, no emitter — see src/lib/person-milestones.server for
  // why the crossing needs no ledger: a belief already knows when it began, so
  // the moment somebody reached five is the start date of the newest of their
  // five, recoverable identically forever.
  //
  // Full fetch only, like standing facts: a delta poll merges into a tail that
  // already carries them, and a conviction count does not move in 30 seconds.
  if (data?.since == null && actorWallets.length > 0) {
    const reached = await buildPersonMilestones({
      wallets: actorWallets,
      nameByWallet: new Map(
        [...profiles].map(([w, p]) => [w, p.displayName ?? aliasFor(w)] as const),
      ),
      titleById,
      sinceMs: Date.now() - LIVE_WINDOW_MS,
      nowMs: Date.now(),
    }).catch(() => []);
    for (const m of reached) {
      const told = tellConvictionMilestone(m);
      material.push({
        id: m.id,
        kind: "person_milestone",
        marketId: String(m.marketId),
        marketTitle: m.marketTitle,
        occurredAt: m.occurredAt,
        startedAt: m.occurredAt,
        side: null,
        walletCount: 1,
        tradeCount: null,
        amountEth: null,
        amountUsd: null,
        wallet: m.wallet,
        people: [{ wallet: m.wallet, name: m.name, avatarUrl: null }],
        story: {
          category: "milestone",
          headline: told.headline,
          body: told.body,
          attribution: told.attribution,
          tone: "neutral",
          personal: false,
        },
        text: `${told.headline} — ${told.body}`,
        // `pace` is set by the scheduling loop below, from classifyPace —
        // setting it here would be overwritten and would read as though this
        // row paced itself.
        //
        // A person crossing a rung is a real community moment, and the scale
        // is the shared one: this sits with a believer milestone, not with a
        // market flip. Persisted in the payload because that is where the
        // mixer reads an EMITTED significance from.
        // `rung` travels with the row so the editorial pass can ask whether a
        // count is interesting to a STRANGER, not merely true.
        payload: { significance: m.rung >= 10 ? 0.72 : 0.6, rung: m.rung },

      } as (typeof material)[number]);
    }
  }

  // ── DISCOVERY: "is there someone here I should meet?" ────────────────────
  // Significance says how big an event is; discovery says whether it opens a
  // relationship, and the synthesized "you two should meet" rows exist for
  // exactly one reader. Both live in one pure pass — see
  // src/lib/insider/composition/discovery-pass.
  const { discovery, seen, momentRows } = runDiscoveryPass({
    material,
    moments,
    cohortPeople,
    labelByWallet,
    relByWallet,
    beliefByKey,
    profiles,
  });
  for (const row of momentRows) material.unshift(row as (typeof material)[number]);


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
      family: familyOf({
        kind: r.kind,
        category: r.story.category,
        // A market-wide story names its own type in the payload; a trade's
        // comes from the grammar above. Either way the mixer now learns WHAT
        // happened, not merely which table the row came from.
        celebration:
          celebrationById.get(r.id) ??
          CELEBRATION_TRANSITIONS.has(String((r.payload as { type?: string } | null)?.type ?? "")),
        personal: r.story.personal,
      }),
      discovery: discovery.get(r.id) ?? 0,
      // Emitted (our own emitters persist it) → derived (scored just above)
      // → fallback, which is now only reachable by a legacy or unknown kind.
      significance: Math.min(
        1,
        /* A receipt-grade sentence is capped, not deleted: an unsized
           percentage sits below the clues instead of leading over them. */
        copyLevel.get(r.id) === "receipt" ? RECEIPT_SIGNIFICANCE_CEILING : 1,
        (typeof (r.payload as { significance?: number }).significance === "number"
          ? (r.payload as { significance: number }).significance
          : (derived.get(r.id) ?? SIGNIFICANCE.fallback)) +
          (viewerBoost.get(r.id) ?? 0) +
          // Your own question, or one your money is in. Never both added —
          // stakeBoost takes the strongest, not the sum.
          stakeBoost(Number(r.marketId), stakes),
      ),
      occurredAt: r.occurredAt,
      marketId: String(r.marketId),
      side: r.side,
      subjects: r.people?.length
        ? r.people.map((x) => x.wallet)
        : r.wallet
          ? [r.wallet.toLowerCase()]
          : [],
      /* A ROLLING STATE STORY IS IDENTIFIED BY ITS CATEGORY, NOT ITS NUMBERS.
         "More believers. Less capital." read at 09:10 and again at 10:00 is one
         evolving state, but the composed headline/detail carry the window's
         figures, so keying the motif on copy made two readings look like two
         developments. Derived market reads therefore key on the TRANSITION TYPE
         (and metric) alone — a change of category still earns a second row,
         a change of numbers does not. Named acts keep the headline key, so the
         genuine beats (new believer → side opens → pile-in → flip) survive. */
      motif:
        (r.payload as { motif?: string } | null)?.motif ??
        (r.kind === "market_transition"
          ? `state:${(r.payload as { type?: string } | null)?.type ?? "move"}:${(r.payload as { metric?: string } | null)?.metric ?? ""}`
          : `${r.kind}:${r.side ?? "market"}:${r.story.headline}`),

      /* HOW LOUD THIS ROW IS ALLOWED TO BE, and what it costs to be that loud
         again (plan §6). The level is the viewer-blind vector's, so the mixer
         charges for a run of contradictions without ever being able to turn a
         true clue into a receipt — a high `signalGain` skips the cost. */
      /* The vector's level, CAPPED by what the printed copy can support. A row
         whose only claim is an unsized percentage cannot be Intelligence no
         matter what the market state around it looks like. */
      voice: (() => {
        const capped = capVoice(voiceLevel(signalById.get(r.id) ?? null), copyLevel.get(r.id));
        /* A FLOOR, NOT A BOOST. Social kinds get an all-zero vector by design,
           so a new market with a proven reaction (or a proven silence) would
           rank as a receipt on a technicality. The floor is only ever set from
           a fact the copy layer verified. */
        const floor = voiceFloor.get(r.id);
        if (!floor) return capped;
        const RANK = { receipt: 0, observation: 1, intelligence: 2 } as const;
        return RANK[floor] > RANK[capped] ? floor : capped;
      })(),
      signalGain: signalById.get(r.id)?.informationGain ?? 0,
      /* THE SHAPE OF THE CLUE, capped window-wide (plan §11.8). The motif keys
         on composed copy, so the same observation across four markets reads as
         four different rows to the mixer and as one sentence to the reader. */
      signalPrimary: signalById.get(r.id)?.primary ?? null,
      signalKind: signalById.get(r.id)?.tensionKind ?? null,
      /* Heartbeat: carried so the mixer can charge for a REPEATED heartbeat
         shape. It changes nothing about how loud this row is — significance,
         voice and gain above are computed identically either way. */
      pulse: pulseIds.has(r.id) || undefined,
    } satisfies MixCandidate;
    if (pulseIds.has(r.id)) r.pulse = true;
  }

  /* ── THE TWO LAYERS, MADE VISIBLE IN THE RANKING ────────────────────────
     Insider is an intelligence layer with an activity layer under it. Two
     things enforce that here, and both only ever lower a row:

     1. THE CANONICAL RULE. If the second sentence does not change how you read
        the first, the row is not intelligence. "NO JUST GOT COMPANY / First
        believers just stepped in." is one fact printed twice, whatever the
        market state around it looks like.
     2. VOICE BANDS. A receipt may not outrank an observation, and an
        observation may not outrank a clue, no matter how much boost the
        reader's own money added. Contradictions, changes before price, unusual
        behaviour and person patterns therefore sit at the top by construction. */
  for (const r of material) {
    if (!r.mix) continue;
    if (
      r.mix.voice === "intelligence" &&
      !secondSentenceAdds(r.story?.headline ?? "", r.story?.body ?? "")
    )
      r.mix.voice = "observation";
    r.mix.significance = Math.min(r.mix.significance, VOICE_CEILING[r.mix.voice ?? "receipt"]);
  }

  /* The vector is computed once per row in `signalById` (above the scoring
     pass) and is now INFLUENTIAL through significance. It is still only
     ATTACHED to the shipped payload under SIGNAL_DIAGNOSTIC=1, so review keeps
     the same shape and the client payload does not grow. */
  if (process.env["SIGNAL_DIAGNOSTIC"] === "1") {
    for (const r of material) r.signal = signalById.get(r.id);
  }

  /* VIEWER-RELATIVE ANGLE, AFTER ADMISSION (plan §7).
     Ranking is viewer-blind — the vector never sees who is reading. Once a row
     is in, the relationship may choose WHICH fact leads: the kicker names the
     reader's person. The clue is not spent to buy that: `applyViewerAngle`
     keeps the market observation in the third line, so a signal-bearing row
     never degrades into a personal-only headline. A zero-vector social row is
     left exactly as the voice layer wrote it. */
  for (const r of material) {
    const rel = (r.face?.relationship as NetLabel | null) ?? null;
    if (!rel || !r.story) continue;
    const angled = applyViewerAngle(r.story, { relationship: rel, signal: signalById.get(r.id) });
    if (angled === r.story) continue;
    r.story = angled;
    r.text = flattenStory(angled);
  }

  // ── THE EDITORIAL PASS: subtraction, after everything is composed ────────
  // Two rules a reader would state out loud — a second row about the same
  // market has to say something the first didn't, and low-value truth is still
  // not news. It runs HERE because it needs the finished copy (the motif is the
  // composed headline) and the finished amounts, and it only ever removes rows,
  // so nothing downstream — ordering, pacing, delta merge — changes shape.
  {
    const keep = new Set(
      editFeed(
        material.map((r) => ({
          id: r.id,
          kind: r.kind,
          marketId: String(r.marketId),
          occurredAt: r.occurredAt,
          motif: r.mix?.motif ?? null,
          amountUsd: r.amountUsd ?? null,
          significance: r.mix?.significance ?? null,
          action: actionById.get(r.id) ?? null,
          personal: r.story?.personal ?? false,
          rung: (r.payload as { rung?: number } | null)?.rung ?? null,
          side: r.side === "YES" || r.side === "NO" ? r.side : null,
          // A market_transition is a DERIVED reading of state; every other
          // family is somebody doing something, with a name attached.
          derived: r.kind === "market_transition",
          metric: (r.payload as { metric?: "capital" | "price" | "believers" } | null)?.metric ?? null,
          // Every derived market read is a rolling-window statement ("in the
          // last hour"), so two of them are two looks at one state.
          rolling: r.kind === "market_transition",
          /* FAMILY IS THE CLAIM, NOT THE TABLE. Five "just got company" rows
             arrive as three different kinds (a trade, a transition, a
             milestone) and read as one sentence repeated. When the printed
             kicker makes the first-participation claim, that IS the family, so
             the cap can ration it. */
          family: /emptied out|nothing behind it now/i.test(r.story?.headline ?? "")
            ? "side_emptied"
            : /got company|first believers?|first capital|stepped in/i.test(
                  r.story?.headline ?? "",
                )
              ? "side_opened"
              : r.kind === "market_transition"
                ? ((r.payload as { type?: string } | null)?.type ?? null)
                : r.kind,

          // Market-scoped rows need the question to make sense standalone.
          context: r.marketId ? (r.marketTitle ?? "").trim().length > 0 : true,
          suppressed: copySuppressed.has(r.id),
          /* A first-participation row earns its slot when the body says
             something the kicker didn't — a number, a person, a counterpoint.
             Otherwise it is one of five identical "just got company" rows and
             the family cap rations it to one. */
          secondFact: secondSentenceAdds(r.story?.headline ?? "", r.story?.body ?? ""),
        })),
      ).map((r) => r.id),
    );
    for (let i = material.length - 1; i >= 0; i--)
      if (!keep.has(material[i]!.id)) material.splice(i, 1);
  }

  // ── CROSS-MARKET PERSON PATTERNS ─────────────────────────────────────────
  // Everything above reasons about ONE question at a time. A person watching
  // the room also notices what one row structurally cannot: that the same
  // person has now backed their third question this afternoon, that everything
  // they touched today is NO, that they sold one belief and bought another.
  //
  // It runs AFTER subtraction, so a pattern only ever describes rows the reader
  // will actually see, and it adds no rows — one aside on the person's newest
  // surviving row. See src/domain/person-pattern.
  /* The pattern text per row, kept even when the pattern is promoted into the
     headline. The question layer below reads it as evidence, and a promoted
     pattern is the strongest evidence of all — losing it there was the second
     reason the PERSON question never fired. */
  const patternById = new Map<string, string>();
  /* Constituent receipts a promoted behavioural story now contains. Dropped
     from the GLOBAL surface only — see below. */
  const consumedByPattern = new Set<string>();
  /**
   * IS THIS ROW ORDINARY EVIDENCE — i.e. may a story that contains it absorb it?
   *
   * Receipts → evidence → pattern → story. Once the pattern has been told at
   * full volume, the constituent transactions are proof, not news; leaving them
   * in makes the reader assemble the same conclusion a second time underneath
   * the one the feed already reached. The exception is the constituent that
   * would have been a story without the pattern: anything the voice layer calls
   * an observation or intelligence keeps its slot.
   */
  const ORDINARY_EVIDENCE_MAX = 0.5;
  const ordinaryEvidence = (id: string): boolean => {
    const r = material.find((x) => x.id === id);
    if (!r) return false;
    return (
      (r.mix?.voice ?? "receipt") === "receipt" &&
      (r.mix?.significance ?? 0) < ORDINARY_EVIDENCE_MAX
    );
  };

  for (const p of findPersonPatterns(
    material.map((r) => ({
      id: r.id,
      wallet: r.wallet ?? null,
      marketId: String(r.marketId),
      marketTitle: r.marketTitle ?? null,
      side: r.side === "YES" || r.side === "NO" ? r.side : null,
      action: actionById.get(r.id) ?? null,
      amountUsd: r.amountUsd ?? null,
      name: r.face?.name ?? null,
      occurredAt: r.occurredAt,
    })),
  )) {
    const target = material.find((r) => r.id === p.rowId);
    if (!target?.story) continue;
    /* WHEN THE PATTERN IS THE INTERESTING PART, IT BECOMES THE STORY — AND IT
       TAKES ITS RECEIPTS WITH IT.
       "Not done / Another $0.02 on NO" with the pattern as an italic footnote
       buries the only clue in the row. Worse, the constituent moves stayed in
       the feed alongside it: ONE LESS, BELIEVER LEFT, OUT, BELIEVER LEFT,
       FLIPPED, plus a small aside noting the person had stepped back from
       several questions. Five rows to say one thing, with the one thing in the
       smallest type. A promoted pattern therefore CONSUMES the rows it is made
       of on the app-wide tape; inside a market panel they stay, because there
       the individual transaction IS the subject.
       Promotion happens when the event is receipt-grade (the pattern clearly
       out-informs it) or when the pattern spans other rows the reader would
       otherwise read separately. */
    patternById.set(p.rowId, p.note);
    const collapsible = !scoped && p.consumes.length > 0;
    if (p.lead && ((target.mix?.voice ?? "receipt") === "receipt" || collapsible)) {
      target.story = {
        ...target.story,
        category: "momentum",
        headline: p.lead.headline.toUpperCase(),
        body: p.lead.body,
        pattern: null,
      };
      target.text = flattenStory(target.story);
      if (target.mix) {
        target.mix.voice = "observation";
        target.mix.significance = Math.max(target.mix.significance, 0.5);
      }
      /* ORDINARY EVIDENCE IS CONSUMED; AN UNUSUAL CONSTITUENT SURVIVES.
         The promoted story now contains the constituent transactions, so
         reprinting them makes the reader reconstruct a pattern the feed has
         already told them. That is only true of ORDINARY receipts, though: a
         constituent that is itself intelligence-grade (a contradiction, a
         whale, a market state change) is news in its own right and is not
         absorbed just because the same wallet is in it. */
      if (collapsible) for (const id of p.consumes) if (ordinaryEvidence(id)) consumedByPattern.add(id);

      continue;
    }
    target.story = { ...target.story, pattern: p.note };
  }
  /* Diagnostic only (SIGNAL_DIAGNOSTIC=1): the receipts a promoted behavioural
     story absorbed, so a reviewer can read the before → after directly. */
  const consumedRows: Array<{ id: string; headline: string }> = [];
  const consumedForClues: typeof material = [];
  if (consumedByPattern.size > 0)
    for (let i = material.length - 1; i >= 0; i--)
      if (consumedByPattern.has(material[i]!.id)) {
        const [gone] = material.splice(i, 1);
        if (gone) {
          consumedForClues.push(gone);
          consumedRows.push({ id: gone.id, headline: gone.story?.headline ?? "" });
        }
      }


  /* ── THE QUESTION LAYER (genuinely last: after subtraction and patterns) ────────────────────────────────
     facts → detect tension → explain what changed → ASK THE OPEN QUESTION.
     Everything above establishes what is true and says it plainly. A row that
     the vector calls Intelligence AND that carries a named unresolved shape —
     a contradiction, a silence after real money, a hierarchy changing hands, a
     person unwinding — earns one question grounded in that shape. Nothing
     else does, and the window keeps at most a handful, so the feed asks where
     asking is warranted instead of interrogating the reader.

     IT RUNS HERE, AND THE POSITION IS THE FEATURE. Drafting and rationing used
     to happen before editorial subtraction and before person patterns existed,
     which made the layer close to invisible in production for two structural
     reasons: the three question slots could be spent on rows `editFeed` then
     deleted (leaving the rendered feed with none), and `piQuestion` was asked
     "does this row have an unwinding pattern?" before `findPersonPatterns` had
     written one — so the PERSON question could never fire at all. The corpus
     the rationer sees is now exactly the corpus the reader sees. */
  /** Diagnostic row for a composed clue (SIGNAL_DIAGNOSTIC=1 reporting). */
  const clueEntry = (c: ComposedClue) => ({
    id: c.rowId,
    kind: c.kind as string,
    source: "composed" as const,
    gain: c.gain,
    why: `${c.why} [${c.members.length} rows]`,
    text: c.text,
    rejected: null as string | null,
    kept: false,
  });
  const questionLedger: Array<{
    id: string;
    kind: string;
    source: "row" | "composed";
    gain: number;
    why: string;
    text: string | null;
    rejected: string | null;
    kept: boolean;
  }> = [];
  {
    const asked: Array<{
      id: string;
      kind: QuestionKind;
      gain: number;
      personal?: boolean;
      text?: string;
    }> = [];
    const drafted = new Map<string, string>();
    /** Ordinary receipts absorbed by a promoted composed clue (see stage 2). */
    const consumedByClue = new Set<string>();


    /* THE PROPOSITION PAIR. Which already-proven STATE, if any, this row sits
       on — the only input the semantic question layer takes beyond the title.
       Everything here is read off state the pipeline already established: the
       composed kicker (which the editorial family classifier reads the same
       way), the market's own believer/capital book, and its age. Nothing is
       inferred about what the question MEANS; that stays the reader's job, and
       the PI only asks. See src/domain/semantic-question. */
    const semanticStateFor = (
      r: (typeof material)[number],
    ): Omit<SemanticInput, "key"> | null => {
      const title = (r.marketTitle ?? "").trim();
      if (title.length === 0) return null;
      const m = momentumById.get(Number(r.marketId));
      const head = r.story?.headline ?? "";
      const side = r.side === "YES" || r.side === "NO" ? r.side : null;
      const ageDays = m?.marketAgeDays ?? null;

      if (/emptied out|nothing behind it now|no one left/i.test(head))
        return { title, state: "side_emptied", side };

      if (/back from the dead|woke this up|this one's back|^a pulse$/i.test(head))
        return {
          title,
          state: "back_from_dead",
          side: null,
          facts: { quietDays: 7, trades: m?.tradeCount24h ?? null },
        };

      if (
        /got company|first capital|stepped into an empty|empty no more/i.test(head) &&
        ageDays != null
      )
        return { title, state: "side_got_company", side, facts: { days: ageDays } };

      /* PERSISTENT ONE-SIDEDNESS. "Still nobody will take NO" is only factual
         when NO is empty RIGHT NOW and the market is old enough for "still" to
         mean something, so both are required and the age is the proven floor. */
      const by = m?.believersYes ?? null;
      const bn = m?.believersNo ?? null;
      if (
        by != null &&
        bn != null &&
        ageDays != null &&
        ageDays >= ONE_SIDED_MIN_DAYS &&
        ((by > 0 && bn === 0) || (bn > 0 && by === 0))
      )
        return {
          title,
          state: "one_sided_persistence",
          side: by > 0 ? "YES" : "NO",
          facts: { days: ageDays },
        };

      const cy = m?.capitalHeldYes ?? null;
      const cn = m?.capitalHeldNo ?? null;
      if (cy != null && cn != null) {
        const lead = Math.max(cy, cn);
        const light = Math.min(cy, cn);
        if (lead >= LOPSIDED_MIN_LEAD_USD && light <= lead * LOPSIDED_RATIO)
          return {
            title,
            state: "lopsided_book",
            side: cy >= cn ? "YES" : "NO",
            facts: { leadUsd: lead, laggardUsd: light },
          };
      }
      return null;
    };

    /* STAGE 1 — SINGLE-ROW CLUES. One vector, one named gap. */
    for (const r of material) {
      if (!r.story) continue;
      /* A HEARTBEAT ROW CANNOT INTERROGATE THE READER. It is in the feed
         because the page had gone quiet, not because anything about it is
         unresolved — asking a question off the back of that would be the
         product manufacturing suspense out of an admission decision. Stage 2
         below is deliberately NOT gated: if this receipt turns out to be part
         of a real pattern, the composed clue may still ask. */
      if (pulseIds.has(r.id)) continue;
      const q = piQuestion({
        key: r.id,
        signal: signalById.get(r.id),
        headline: r.story.headline,
        body: r.story.body,
        pattern: r.story.pattern ?? patternById.get(r.id) ?? null,
        actorName: r.face?.name ?? r.people?.[0]?.name ?? null,
        standing: standingKindById.get(r.id) ?? null,
        semantic: semanticStateFor(r),
        unusual: { trades24h: momentumById.get(Number(r.marketId))?.tradeCount24h ?? null },
      });
      if (!q) continue;
      drafted.set(r.id, q.text);
      /* A SEMANTIC QUESTION CARRIES ITS OWN WEIGHT. Its evidence is the proven
         state shape and the proposition, not the row's mechanical vector —
         which on a derived state reading ("NO has nothing behind it now") is
         near zero, i.e. under the rationer's floor. Weighing it that way is why
         the best layup in the corpus was never asked. */
      const gain =
        q.kind === "semantic"
          ? Math.max(signalById.get(r.id)?.informationGain ?? 0, SEMANTIC_GAIN)
          : (signalById.get(r.id)?.informationGain ?? 0);
      asked.push({
        id: r.id,
        kind: q.kind,
        gain,
        personal: r.face?.relationship != null,
        text: q.text,

      });
      questionLedger.push({
        id: r.id,
        kind: q.kind,
        source: "row",
        gain: signalById.get(r.id)?.informationGain ?? 0,
        why: "single-row signal shape",
        text: q.text,
        rejected: null,
        kept: false,
      });
    }

    /* STAGE 2 — COMPOSED CLUES. The 7:30-dinner stage: facts that are dull
       alone and pointed together. A group of plain receipts may earn a question
       here that none of its members could earn above, which is the whole reason
       Insider is not a ticker. Runs on the FINAL rows, so a composed clue can
       only ever be built from evidence the reader can actually see. */
    /* Evidence includes the receipts a promoted behavioural story absorbed:
       they are the reason the behaviour is a fact, and dropping them here would
       make a person's five moves look like one. They can never be the anchor —
       `surviving: false` keeps a question off a row the reader cannot see.
       It also includes the moves the admission gate rejected — the dust in
       particular. A two-cent add is not a story and never gets a slot, but
       three of them by one wallet are how a repositioning is PROVED, and
       throwing that evidence away at the gate is how the composition layer ends
       up guessing. Same `surviving: false` rule: evidence, never an anchor. */
    for (const c of composeClues(
      [...material, ...consumedForClues, ...unadmitted.map(({ r }) => r)].map((r) => ({
        id: r.id,
        marketId: String(r.marketId),
        marketTitle: r.marketTitle ?? null,
        wallet: r.wallet ?? null,
        name: r.face?.name ?? null,
        relationship: (r.face?.relationship as string | null) ?? null,
        side: r.side === "YES" || r.side === "NO" ? r.side : null,
        action: actionById.get(r.id) ?? null,
        amountUsd: r.amountUsd ?? null,
        kind: r.kind,
        occurredAt: r.occurredAt,
        surviving: material.some((m) => m.id === r.id) && !consumedByPattern.has(r.id),
      })),
    )) {
      const target = material.find((r) => r.id === c.rowId);
      if (!target?.story) continue;
      /* WHEN THE COMPOSITION IS THE BETTER CLUE, IT WINS.
         A row may already have drafted a question off its own vector. That
         question is more specific, so it keeps its slot — unless the composed
         clue is measurably stronger, which is common: a single receipt scoring
         0.05 sitting under a behaviour assembled from four of them. */
      const own = asked.find((a) => a.id === c.rowId);
      if (own && own.gain >= c.gain) {
        questionLedger.push({ ...clueEntry(c), rejected: "row asks a stronger question", kept: false });
        continue;
      }
      // Same echo bar as every other question: it must add a term the row
      // has not already printed.
      const said = `${target.story.headline} ${target.story.body} ${target.story.pattern ?? ""}`;
      if (!questionAdds(c.text, said)) {
        questionLedger.push({ ...clueEntry(c), rejected: "echoes the row", kept: false });
        continue;
      }
      drafted.set(c.rowId, c.text);
      if (own) {
        asked.splice(asked.indexOf(own), 1);
        const prior = questionLedger.find((e) => e.id === c.rowId && e.source === "row");
        if (prior) prior.rejected = "superseded by the composed clue";
      }
      asked.push({
        id: c.rowId,
        kind: c.kind,
        gain: c.gain,
        personal: target.face?.relationship != null,
        text: c.text,
      });
      questionLedger.push(clueEntry(c));

      /* THE COMPOSITION OWNS THE ROW IT ASKS ABOUT — AND CONSUMES ITS EVIDENCE.
         Hanging "4 changes in a few hours, backing away or moving conviction?"
         under a body that only establishes "NO had no one, then they stepped
         in" is a mismatch the reader can see: the question is about a behaviour
         the row does not describe. Where the clue is a person's behaviour and
         the anchor is an ordinary receipt, the behaviour becomes the headline
         and the receipt becomes the evidence line under it. The other ordinary
         constituents are then absorbed: they are how the behaviour was proved,
         not nine separate things that happened. */
      if (!scoped && c.lead && (target.mix?.voice ?? "receipt") === "receipt") {
        target.story = {
          ...target.story,
          category: "momentum",
          headline: c.lead.headline.toUpperCase(),
          body: c.lead.body,
          pattern: null,
        };
        target.text = flattenStory(target.story);
        if (target.mix) {
          target.mix.voice = "observation";
          target.mix.significance = Math.max(target.mix.significance, 0.5);
        }
        for (const id of c.members)
          if (id !== c.rowId && ordinaryEvidence(id)) consumedByClue.add(id);
      }
    }

    /* Absorb before rationing, never after: the budget must be spent on rows
       the reader will actually see, and a question attached to a row that is
       about to disappear is a slot thrown away. */
    if (consumedByClue.size > 0) {
      for (let i = material.length - 1; i >= 0; i--)
        if (consumedByClue.has(material[i]!.id)) {
          const [gone] = material.splice(i, 1);
          if (gone) consumedRows.push({ id: gone.id, headline: gone.story?.headline ?? "" });
        }
      for (let i = asked.length - 1; i >= 0; i--)
        if (consumedByClue.has(asked[i]!.id)) asked.splice(i, 1);
    }

    /* STAGE 3 — RATIONING, over exactly the rows the reader will see. */
    const intelligenceRows = material.filter(
      (r) => (r.mix?.voice ?? "receipt") === "intelligence",
    ).length;
    const keep = rationQuestions(asked, questionBudget(material.length, intelligenceRows));
    for (const r of material) {
      if (!r.story) continue;
      const text = keep.has(r.id) ? (drafted.get(r.id) ?? null) : null;
      if (!text) continue;
      /* A question is the interpretation layer, not a fourth repetition of the
         evidence. If the body only restates the kicker ("NO just got company" /
         "First believers just stepped in"), absorb it before attaching the
         question. Bodies carrying a number, person or counterpoint survive. */
      const body = secondSentenceAdds(r.story.headline, r.story.body) ? r.story.body : "";
      r.story = { ...r.story, body, question: text };
      r.text = flattenStory(r.story);
    }
    for (const e of questionLedger) if (keep.has(e.id) && !e.rejected) e.kept = true;
  }










  // PACING INPUTS. How urgent (from what the row is) and how heavy (from the
  // tier the gate already computed). Every row gets these, including the
  // synthesized discovery moments, so the client never has to guess — a row
  // with no pace would be scheduled as ordinary, which for a NEW TWIN is the
  // one outcome that would make the whole thing pointless.
  for (const r of material) {
    r.pace = {
      perishability: classifyPace({
        kind: r.kind,
        action: actionById.get(r.id) ?? null,
        isViewer: viewer != null && r.wallet?.toLowerCase() === viewer,
      }),
      // A discovery moment is the rarest row the product has; nothing about
      // it should ever be scheduled as texture. A person milestone has no
      // trade tier to inherit and would default to texture — it is a moment,
      // and the scheduler must not pace it like a dust buy.
      weight:
        r.kind === "discovery_moment"
          ? 1
          : r.kind === "person_milestone"
            ? 2
            : (tierById.get(r.id) ?? 3),
    };
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

  // Standing stories are built with the rest of the material, far above this
  // point — they are a story TYPE, not a lane, and nothing about them belongs
  // in the tail of the pipeline any more.



  // ── SOMEBODY SHOWED UP ───────────────────────────────────────────────────
  // The one family in this tape that is about the READER rather than a market:
  // people who answered a call the reader's own conviction created.
  //
  // AGGREGATED, ONE ROW PER MARKET. Three people answering the same question is
  // one thing that happened to you, not three, and a row each would turn the
  // tape into a notification inbox that gets loudest on your best day. The
  // domain composes the sentence; see showedUpInMarket.
  //
  // Unscoped only: inside a market panel the reader is already looking at the
  // question, and a "somebody showed up here" row would be talking about the
  // thing on screen. Full fetches only, like standing facts — a delta poll
  // merges into a tail that already carries them.
  if (!scoped && viewer && data?.since == null) {
    const { showedUpForMe } = await import("@/lib/challenge.server");
    const since = Date.now() - SHOWED_UP_WINDOW_MS;
    const answers = await showedUpForMe(viewer, since).catch(() => []);
    for (const a of answers.slice(0, SHOWED_UP_MAX)) {
      const body = showedUpInMarket(a.people.map((p) => p.name ?? ""));
      // The domain refuses to speak about people it cannot name, and an
      // unnamed row here would read as "somebody showed up", which is worse
      // than silence — it is the feeling without the person.
      if (!body) continue;
      material.push({
        id: `showed-up:${a.marketId}:${a.atMs}`,
        kind: "showed_up",
        marketId: String(a.marketId),
        marketTitle: a.title,
        occurredAt: new Date(a.atMs).toISOString(),
        startedAt: new Date(a.atMs).toISOString(),
        // Answering is PARTICIPATION. Which side they took is Conviction
        // Match's question and never this one, so no side is carried here.
        side: null,
        walletCount: a.people.length,
        tradeCount: null,
        amountEth: null,
        amountUsd: null,
        wallet: a.people.length === 1 ? a.people[0].wallet : null,
        people: a.people.map((p) => ({ wallet: p.wallet, name: p.name, avatarUrl: null })),
        story: {
          category: "tribe",
          headline: "Showed up",
          body,
          attribution: null,
          // NEUTRAL, and not merely because "positive" is not a BeatTone. The
          // other tones are `yes` and `no` — they carry a SIDE, and tinting
          // this row by one would say the answer counted because of which way
          // it went. Showing up is participation; the side is Conviction
          // Match's question and never this one.
          tone: "neutral",
          // The "about you" wash, and the one row in the tape that has earned
          // it most: this did not merely involve your network, it happened
          // BECAUSE of something you did.
          personal: true,
        },
        text: `Showed up — ${body}`,
        // Newsworthy but not urgent: it stays true all day, and it should
        // never preempt a market that is actually moving right now.
        pace: { perishability: "soon", weight: 1 },
        payload: { significance: 0.9 },
      });
    }
  }

  /* THE BUILD THAT WROTE THESE SENTENCES. The client refuses to merge a cached
     tail composed by a different build, so a copy fix can never be left on
     screen by the sticky tape. See src/domain/copy-version. */
  return {
    rows: material,
    copyVersion: COPY_VERSION,

    error: null,
    ...(process.env["SIGNAL_DIAGNOSTIC"] === "1"
      ? {
          composition: { consumed: consumedRows.reverse() },
          questions: questionLedger,
        }
      : {}),
  };
}
