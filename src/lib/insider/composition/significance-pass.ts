/**
 * INSIDER — THE SIGNIFICANCE PASS.
 *
 * The first ranking dimension: how much of the reader's attention an event is
 * owed. Lifted out of `buildTape` whole, in two halves so the one bounded read
 * it depends on (hourly price paths, for temporal proof) stays in the source
 * layer where every other IO lives:
 *
 *   1. `buildCandidates(...)` — pure. Turns composed rows into the ONE candidate
 *      per row that the gate, the score and the batch bar all read.
 *   2. `runSignificancePass(...)` — pure. Adaptive floor, heartbeat bar, anomaly
 *      vectors, admission, tier, derived score, and the rejected-but-evidential
 *      rows the composition layer absorbs.
 *
 * The caller loads the price paths between the two, because the markets to read
 * are only known once the candidates exist.
 */
import { scoreFeedEvent, type NetTag, type FeedCandidate } from "@/domain/feed-event";
import { adaptiveFloor, admissionOf, silenceAdjustedFloor } from "@/domain/feed-density";
import { scoreLiveAction } from "@/domain/significance";
import { signalVector } from "@/domain/signal-vector";
import { factsForRow } from "@/domain/signal-facts";
import { priceProofSince, type PriceSample } from "@/domain/price-proof";
import { signalFromTransition, mergeSignals, dominantKey } from "@/domain/transition-signal";
import type { LiveRow } from "@/lib/live-tape";
import type { Momentum } from "@/lib/insider/source.server";

/** The conviction actions the importance engine understands. */
const BELIEF_ACTIONS = new Set(["enter", "add", "reduce", "exit", "flip", "round_trip"]);

/**
 * Narrow the grammar's action to the subset the scorer weighs. `open_market`,
 * `milestone` and `surge` are not things a PERSON did to a belief, so they carry
 * no tenure meaning and are scored on their own structural terms.
 */
export function beliefAction(a: string | undefined | null) {
  return a && BELIEF_ACTIONS.has(a) ? (a as "enter" | "add" | "reduce" | "exit" | "flip") : null;
}

export interface BeliefLike {
  yesShares?: number | null;
  noShares?: number | null;
  daysHeld?: number | null;
}

/** One row, judged once — used by the gate, the score and the batch bar. */
export interface Candidate<R extends LiveRow> {
  r: R;
  candidate: FeedCandidate;
  fullExit: boolean;
  daysHeld: number | null;
}

export function buildCandidates<R extends LiveRow>({
  live,
  unrenderable,
  momentumById,
  beliefByKey,
  actionById,
}: {
  live: R[];
  unrenderable: Set<string>;
  momentumById: Map<number, Momentum>;
  beliefByKey: Map<string, BeliefLike>;
  actionById: Map<string, string>;
}): Array<Candidate<R>> {
  return live
    .filter((r) => !unrenderable.has(r.id))
    .map((r) => {
      const m = momentumById.get(Number(r.marketId));
      const marketBelievers = m ? (m.believersYes ?? 0) + (m.believersNo ?? 0) : null;
      const b = r.wallet
        ? beliefByKey.get(`${r.wallet.toLowerCase()}:${Number(r.marketId)}`)
        : null;
      const heldSide = r.side === "YES" ? b?.yesShares : b?.noShares;
      const sell = (r.payload as { action?: string }).action === "SELL";
      const fullExit = sell && heldSide != null && heldSide <= 0;
      const conviction = beliefAction(actionById.get(r.id));
      return {
        r,
        candidate: {
          kind: r.kind,
          side: r.side as FeedCandidate["side"],
          amountUsd: r.amountUsd,
          walletCount: r.walletCount,
          tradeCount: r.tradeCount,
          windowMs: Number((r.payload as { window_ms?: number }).window_ms ?? 0) || null,
          relationship: (r.face?.relationship as NetTag | null) ?? null,
          marketBelievers,
          conviction,
          daysHeld: b?.daysHeld ?? null,
        },
        fullExit,
        daysHeld: b?.daysHeld ?? null,
      } as Candidate<R>;
    });
}

/** The markets a bounded price-path read must cover for temporal proof. */
export function candidateMarkets<R extends LiveRow>(scored: Array<Candidate<R>>): number[] {
  return [...new Set(scored.map(({ r }) => Number(r.marketId)).filter(Number.isFinite))];
}

export interface SignificancePassResult<R extends LiveRow> {
  floor: number;
  relaxed: boolean;
  /** Candidacy bar at full silence pressure — the client decides release. */
  pulseBar: number;
  signalById: Map<string, ReturnType<typeof signalVector>>;
  /** Standing rows carry their shape so the question layer can ask about contrast. */
  standingKindById: Map<string, { kind: string; klass: string }>;
  derived: Map<string, number>;
  tierById: Map<string, number>;
  pulseIds: Set<string>;
  material: R[];
  /** Rejected small moves, kept as non-surviving evidence for composition. */
  unadmitted: Array<Candidate<R>>;
}

export function runSignificancePass<R extends LiveRow>({
  scored,
  momentumById,
  pricePaths,
  nowMs = Date.now(),
}: {
  scored: Array<Candidate<R>>;
  momentumById: Map<number, Momentum>;
  pricePaths: Map<number, PriceSample[]>;
  nowMs?: number;
}): SignificancePassResult<R> {
  // ADAPTIVE DENSITY. The absolute gate asks "is this big?" and on a quiet chain
  // the honest answer is no for everything, which is how a live market renders
  // as two rows. The editorial question is "is this the biggest thing that
  // happened today?", so the bar comes from the distribution of what exists. On
  // a busy day this changes nothing. Washes and dust never return.
  const { floor, relaxed } = adaptiveFloor(
    scored.map(({ candidate }) => scoreFeedEvent(candidate).score),
  );
  /* THE HEARTBEAT BAR. The server cannot know how long a reader has been
     watching a still page — the anonymous tape is one cached answer handed to
     everyone — so it does not try to. It computes CANDIDACY at full silence
     pressure and marks what only clears that bar; the client, which is the only
     place a per-reader clock exists, decides release (src/domain/pulse-release). */
  const pulseBar = silenceAdjustedFloor(floor, 1);

  /* ANOMALY, MEASURED ONCE PER ROW.
     The vector is viewer-blind and pure, so it is computed here — before
     significance — and reused by the diagnostic attach further down. It feeds
     significance as SUPPORTING evidence only: `scoreLiveAction` still caps an
     individual action below the exceptional band, so an anomalous market can
     never manufacture a structural story.
     `preEventHolders` is deliberately null in-feed: reconstructing the holder
     hierarchy needs a bounded historical read the tape does not do, and a large
     amount is never allowed to stand in for "a whale left". */
  const signalNowMs = nowMs;
  const signalById = new Map<string, ReturnType<typeof signalVector>>();
  const standingKindById = new Map<string, { kind: string; klass: string }>();

  for (const { r } of scored) {
    const m = momentumById.get(Number(r.marketId));
    const occurredMs = r.occurredAt ? Date.parse(r.occurredAt) : NaN;
    const proof = Number.isFinite(occurredMs)
      ? priceProofSince(pricePaths.get(Number(r.marketId)), occurredMs, signalNowMs)
      : null;
    signalById.set(
      r.id,
      signalVector(
        factsForRow(
          {
            kind: r.kind,
            wallet: r.wallet,
            action: (r.payload as { action?: "BUY" | "SELL" }).action ?? null,
            amountUsd: r.amountUsd,
            occurredAt: r.occurredAt,
          },
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
          proof,
        ),
      ),
    );

    /* A DERIVED READING CARRIES ITS OWN EVIDENCE (see transition-signal).
       The vector above reads market state as it is NOW; a transition emitted
       four hours ago was measured against windows that have since rolled, so
       a proven contradiction was arriving with an all-zero vector — ranked as
       a receipt and, worse, structurally unable to earn the open question.
       The emitter's frozen type and significance are re-read here, decayed by
       age, and merged so the live state still wins wherever it sees more. */
    if (r.kind === "market_transition") {
      const p = r.payload as { type?: string | null; significance?: number | null } | null;
      const atMs = r.occurredAt ? Date.parse(r.occurredAt) : NaN;
      const own = Number.isFinite(atMs)
        ? signalFromTransition({
            type: p?.type ?? null,
            significance: p?.significance ?? null,
            ageHours: (signalNowMs - atMs) / 3_600_000,
          })
        : null;
      const liveSignal = signalById.get(r.id);
      if (own && liveSignal) {
        const merged = mergeSignals(liveSignal, own);
        signalById.set(r.id, {
          ...merged,
          primary:
            liveSignal.informationGain >= own.informationGain
              ? liveSignal.primary
              : (dominantKey(own) as typeof liveSignal.primary),
        });
      }
    }
  }

  const derived = new Map<string, number>();
  // The tier the admission gate computes and used to discard. It is exactly
  // "how much of the reader's attention is this owed", already calculated —
  // without carrying it forward every row arrived at the client looking
  // equally important, whatever it was.
  const tierById = new Map<string, number>();
  /* Rows that got in ONLY because the bar bent for silence. Comparative by
     construction (see `admissionOf`): a genuinely meaningful row that happens
     to arrive in a quiet window is NOT one of these, so it keeps every right a
     row has, including the right to be questioned. */
  const pulseIds = new Set<string>();
  /* DUST IS NOT NEWS AND IS STILL EVIDENCE.
     A $0.02 add can never earn a slot of its own — that is the dust rule in
     `admitToFeed` and it does not move. But three of them by one person are how
     "KODAK IS REPOSITIONING" gets proved, so the rejected small moves are kept
     here and handed to the composition layer as non-surviving evidence. */
  const unadmitted: Array<Candidate<R>> = [];
  const material = scored
    .filter(({ r, candidate }) => {
      const a = admissionOf(candidate, { floor, silenceFloor: pulseBar });
      if (a === "pulse") pulseIds.add(r.id);
      return a !== null;
    })
    .map(({ r, candidate, fullExit, daysHeld }) => {
      const v = signalById.get(r.id);
      derived.set(
        r.id,
        scoreLiveAction(candidate, {
          daysHeld,
          fullExit,
          signal: v ? { informationGain: v.informationGain, primary: v.primary } : null,
        }).score,
      );
      tierById.set(r.id, scoreFeedEvent(candidate).tier);
      return r;
    });
  const admitted = new Set(material.map((r) => r.id));
  for (const s of scored) if (!admitted.has(s.r.id) && s.r.wallet) unadmitted.push(s);

  return {
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
  };
}
