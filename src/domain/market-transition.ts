/**
 * MARKET TRANSITION — the interpretation layer over already-computed facts.
 *
 * The side feed explains the FACTS of one side ("4 believers joined YES"). This
 * reads YES and NO together and names the MEANING for the whole market — the one
 * high-value state a neutral observer would call out:
 *
 *     More believers. Less capital.
 *     Capital is concentrating on YES.
 *     Price moved, but conviction did not.
 *     Participation is broadening.
 *     The market is becoming divided.
 *     NO is losing believers.
 *     YES is accelerating.
 *
 * It is NOT another scoring system. It reuses the feed-event trigger thresholds
 * (capitalTrigger, FEED_TRIGGERS) and the metric-display rules, and interprets a
 * normalized snapshot of the per-side windows the rest of the app already builds.
 *
 * Two disciplines keep it calm:
 *   • PRIORITY — when several states are true, the most informative one wins:
 *     people/capital divergence → capital concentration → price/conviction
 *     divergence → market dividing → (social) → acceleration → simple momentum
 *     (broadening) → directional decline. A contradiction carries more
 *     information than a plain gain, so it is named first.
 *   • HYSTERESIS — a state has a strong ENTER bar and a looser EXIT bar (via the
 *     caller-supplied `prev`), so an interpretation doesn't flap on every trade.
 *
 * A `fingerprint` identifies the state (type + side) so callers can dedupe and
 * avoid repeating the same insight. Baseline-dependent claims ("4× normal") are
 * only made when a trustworthy baseline is supplied — never faked.
 *
 * ZERO IO, pure, fully testable.
 */
import { capitalTrigger, FEED_TRIGGERS } from "./feed-event";
import { formatPct } from "./metric-display";

export type Side = "YES" | "NO";

export type TransitionType =
  | "market_dividing"
  | "people_capital_divergence"
  | "concentration_rising"
  | "price_conviction_divergence"
  | "participation_broadening"
  | "tribe_forming"
  | "accelerating"
  | "losing_conviction";

/** One side's already-computed window, normalized. Money is USD. */
export interface SideWindow {
  believerDelta: number;
  believerBase: number;
  capitalDeltaUsd: number;
  capitalBaseUsd: number;
  pricePct?: number | null;
  /** Recent capital inflow (USD) for the acceleration check vs baseline. */
  recentCapitalUsd?: number | null;
}

export interface MarketBaseline {
  /**
   * The ranker's acceleration multiple (recent trade rate ÷ normal 24h rate),
   * from accelerationFrom — the canonical, server-computed baseline. Preferred
   * over the raw capital fields below; when present it drives the acceleration
   * state directly (attributed to whichever side is drawing capital now).
   */
  accelerationMultiple?: number | null;
  /** The market's normal capital velocity (USD over the same recent window). */
  normalCapitalUsd?: number | null;
}

export interface MarketSocial {
  tribeJoinedYes: number;
  tribeJoinedNo: number;
}

export interface MarketTransitionInput {
  /** Short label of the active timeframe, for copy ("1D", "1H"). */
  timeframeShort: string;
  yes: SideWindow;
  no: SideWindow;
  baseline?: MarketBaseline | null;
  social?: MarketSocial | null;
  /** The previously-emitted transition, for hysteresis. */
  prev?: { type: TransitionType; side?: Side } | null;
  /** USD → the viewer's display unit, for evidence/detail. Optional. */
  money?: (usd: number) => string;
}

export interface MetricEvidence {
  label: string;
  value: string;
}

export interface MarketTransition {
  type: TransitionType;
  side?: Side;
  tier: 1 | 2 | 3;
  headline: string;
  detail?: string;
  evidence: MetricEvidence[];
  /** Stable id of the state (type + side) — for dedup and anti-spam. */
  fingerprint: string;
}

const TIER: Record<TransitionType, 1 | 2 | 3> = {
  market_dividing: 1,
  people_capital_divergence: 1,
  tribe_forming: 1,
  concentration_rising: 2,
  price_conviction_divergence: 2,
  participation_broadening: 2,
  accelerating: 2,
  losing_conviction: 3,
};

const plural = (n: number, one: string, many: string): string => (Math.abs(n) === 1 ? one : many);

/** Acceleration hysteresis: enter loud, stay until it clearly calms. */
const ACCEL_ENTER = FEED_TRIGGERS.capital.spikeMultiple; // 3×
const ACCEL_EXIT = 2; // 2×
/** A believer swing this size is "meaningful" (reuses the people trigger). */
const BEL = FEED_TRIGGERS.believers.minAbs;
/** A Tribe cluster this size on one side reads as a movement forming. */
const TRIBE_FORMING_MIN = 3;

const money = (fn: MarketTransitionInput["money"], usd: number): string =>
  fn ? fn(Math.abs(usd)) : `$${Math.abs(usd).toFixed(2)}`;

const fp = (type: TransitionType, side?: Side): string => `${type}:${side ?? "market"}`;
const held = (prev: MarketTransitionInput["prev"], type: TransitionType, side?: Side): boolean =>
  !!prev && prev.type === type && prev.side === side;

/** The side carrying the most capital action — for a deterministic tie-break. */
function dominantSide(input: MarketTransitionInput): Side {
  return Math.abs(input.no.capitalDeltaUsd) > Math.abs(input.yes.capitalDeltaUsd) ? "NO" : "YES";
}

/**
 * Interpret the snapshot into the single strongest current transition, or null
 * when nothing rises above noise. Deterministic: candidates are tried in strict
 * priority order and the first that clears its (hysteresis-aware) bar wins.
 */
export function emitMarketTransition(input: MarketTransitionInput): MarketTransition | null {
  const { yes, no, baseline, social, prev, money: fmt } = input;

  // Sides in a deterministic order — the one with the most capital action first.
  const sides: [Side, SideWindow][] =
    dominantSide(input) === "YES"
      ? [
          ["YES", yes],
          ["NO", no],
        ]
      : [
          ["NO", no],
          ["YES", yes],
        ];
  const firstOf = (fn: (side: Side, s: SideWindow) => MarketTransition | null) => {
    for (const [side, s] of sides) {
      const r = fn(side, s);
      if (r) return r;
    }
    return null;
  };

  // The capital SAFEGUARD: a move must clear BOTH an absolute floor AND a
  // market-relative bar (feed-event's own capitalTrigger), so −$1 in a tiny market
  // and −$500 of normal noise in a huge one never become a story. No new thresholds.
  const capitalMoved = (s: SideWindow): boolean =>
    capitalTrigger({ deltaUsd: s.capitalDeltaUsd, priorUsd: s.capitalBaseUsd });

  // 1 — PEOPLE / CAPITAL DIVERGENCE (the most information: people in, money out).
  const peopleCapital = (side: Side, s: SideWindow): MarketTransition | null => {
    const active = s.believerDelta >= BEL && s.capitalDeltaUsd < 0 && capitalMoved(s);
    const hold =
      held(prev, "people_capital_divergence", side) &&
      s.believerDelta > 0 &&
      s.capitalDeltaUsd < 0 &&
      capitalMoved(s);
    if (!active && !hold) return null;
    const left = money(fmt, s.capitalDeltaUsd);
    return {
      type: "people_capital_divergence",
      side,
      tier: TIER.people_capital_divergence,
      headline: "More believers. Less capital.",
      detail: `${s.believerDelta} ${plural(s.believerDelta, "person", "people")} joined while ${left} left the market.`,
      evidence: [
        { label: "Believers", value: `+${s.believerDelta}` },
        { label: "Capital", value: `−${left}` },
      ],
      fingerprint: fp("people_capital_divergence", side),
    };
  };

  // 2 — CAPITAL CONCENTRATION (money in, but no broader participation).
  const concentration = (side: Side, s: SideWindow): MarketTransition | null => {
    const active = s.capitalDeltaUsd > 0 && s.believerDelta <= 0 && capitalMoved(s);
    const hold =
      held(prev, "concentration_rising", side) &&
      s.capitalDeltaUsd > 0 &&
      s.believerDelta <= 0 &&
      capitalMoved(s);
    if (!active && !hold) return null;
    const gained = money(fmt, s.capitalDeltaUsd);
    return {
      type: "concentration_rising",
      side,
      tier: TIER.concentration_rising,
      headline: `Capital is concentrating on ${side}.`,
      detail: `${side} gained ${gained} without adding new believers.`,
      evidence: [
        { label: "Capital", value: `+${gained}` },
        { label: "Believers", value: `${s.believerDelta >= 0 ? "+" : ""}${s.believerDelta}` },
      ],
      fingerprint: fp("concentration_rising", side),
    };
  };

  // 3 — PRICE / CONVICTION DIVERGENCE (price re-rated with no one behind it).
  const priceDivergence = (side: Side, s: SideWindow): MarketTransition | null => {
    const p = s.pricePct ?? 0;
    const active = p >= FEED_TRIGGERS.price.minPct && s.believerDelta <= 0;
    const hold =
      held(prev, "price_conviction_divergence", side) && p >= ACCEL_EXIT && s.believerDelta <= 0;
    if (!active && !hold) return null;
    return {
      type: "price_conviction_divergence",
      side,
      tier: TIER.price_conviction_divergence,
      headline: "Price moved, but conviction did not.",
      detail: `${side} re-rated ${formatPct(p)} with no new believers behind it.`,
      evidence: [
        { label: "Price", value: formatPct(p) },
        { label: "Believers", value: `${s.believerDelta >= 0 ? "+" : ""}${s.believerDelta}` },
      ],
      fingerprint: fp("price_conviction_divergence", side),
    };
  };

  // 4 — MARKET DIVIDING (both sides gaining believers, comparably).
  const marketDividing = (): MarketTransition | null => {
    const enter = yes.believerDelta >= BEL && no.believerDelta >= BEL;
    const hold = yes.believerDelta >= 1 && no.believerDelta >= 1;
    if (!(held(prev, "market_dividing") ? hold : enter)) return null;
    const min = Math.min(yes.believerDelta, no.believerDelta);
    const max = Math.max(yes.believerDelta, no.believerDelta);
    if (!(max === 0 || min / max >= 0.5)) return null; // lopsided → directional, not divided
    return {
      type: "market_dividing",
      tier: TIER.market_dividing,
      headline: "The market is becoming divided.",
      detail: `Both sides are gaining believers (+${yes.believerDelta} YES · +${no.believerDelta} NO).`,
      evidence: [
        { label: "YES believers", value: `+${yes.believerDelta}` },
        { label: "NO believers", value: `+${no.believerDelta}` },
      ],
      fingerprint: fp("market_dividing"),
    };
  };

  // SOCIAL — a Tribe cluster forming (viewer-specific; only when social is passed).
  const tribeForming = (): MarketTransition | null => {
    if (!social) return null;
    const forming: Side | null =
      social.tribeJoinedYes >= TRIBE_FORMING_MIN && social.tribeJoinedYes >= social.tribeJoinedNo
        ? "YES"
        : social.tribeJoinedNo >= TRIBE_FORMING_MIN
          ? "NO"
          : null;
    if (!forming) return null;
    const n = forming === "YES" ? social.tribeJoinedYes : social.tribeJoinedNo;
    return {
      type: "tribe_forming",
      side: forming,
      tier: TIER.tribe_forming,
      headline: `A Tribe is forming around ${forming}.`,
      detail: `${n} of your Tribe backed ${forming}.`,
      evidence: [{ label: "Tribe", value: `+${n}` }],
      fingerprint: fp("tribe_forming", forming),
    };
  };

  // 5 — ACCELERATION — from the canonical ranker multiple (preferred), else raw
  // capital velocity. Attributed to the side drawing capital; never faked.
  const acceleration = (): MarketTransition | null => {
    const accelSide = (multiple: number): MarketTransition | null => {
      const side: Side = yes.capitalDeltaUsd >= no.capitalDeltaUsd ? "YES" : "NO";
      const gaining = Math.max(yes.capitalDeltaUsd, no.capitalDeltaUsd) > 0;
      const bar = held(prev, "accelerating", side) ? ACCEL_EXIT : ACCEL_ENTER;
      if (!(gaining && multiple >= bar)) return null;
      return {
        type: "accelerating",
        side,
        tier: TIER.accelerating,
        headline: `${side} is accelerating.`,
        detail: `Flow is ${multiple.toFixed(1)}× normal.`,
        evidence: [{ label: "Flow", value: `${multiple.toFixed(1)}× normal` }],
        fingerprint: fp("accelerating", side),
      };
    };
    if (baseline?.accelerationMultiple != null) {
      const r = accelSide(baseline.accelerationMultiple);
      if (r) return r;
    }
    if (baseline?.normalCapitalUsd != null && baseline.normalCapitalUsd > 0) {
      for (const [side, s] of sides) {
        const recent = s.recentCapitalUsd ?? s.capitalDeltaUsd;
        if (recent <= 0) continue;
        const multiple = recent / baseline.normalCapitalUsd;
        const bar = held(prev, "accelerating", side) ? ACCEL_EXIT : ACCEL_ENTER;
        if (multiple >= bar) {
          return {
            type: "accelerating",
            side,
            tier: TIER.accelerating,
            headline: `${side} is accelerating.`,
            detail: `Flow is ${multiple.toFixed(1)}× normal.`,
            evidence: [{ label: "Flow", value: `${multiple.toFixed(1)}× normal` }],
            fingerprint: fp("accelerating", side),
          };
        }
      }
    }
    return null;
  };

  // 6 — SIMPLE MOMENTUM: participation broadening (people AND money rising together).
  const broadening = (side: Side, s: SideWindow): MarketTransition | null => {
    const active = s.believerDelta >= BEL && s.capitalDeltaUsd > 0 && capitalMoved(s);
    const hold =
      held(prev, "participation_broadening", side) &&
      s.believerDelta >= 1 &&
      s.capitalDeltaUsd > 0 &&
      capitalMoved(s);
    if (!active && !hold) return null;
    return {
      type: "participation_broadening",
      side,
      tier: TIER.participation_broadening,
      headline: "Participation is broadening.",
      detail: `Believers and capital are rising together on ${side}.`,
      evidence: [
        { label: "Believers", value: `+${s.believerDelta}` },
        { label: "Capital", value: `+${money(fmt, s.capitalDeltaUsd)}` },
      ],
      fingerprint: fp("participation_broadening", side),
    };
  };

  // …and directional decline as the last resort.
  const losing = (): MarketTransition | null => {
    const side: Side | null =
      yes.believerDelta <= -BEL && yes.believerDelta <= no.believerDelta
        ? "YES"
        : no.believerDelta <= -BEL
          ? "NO"
          : null;
    if (!side) return null;
    const d = side === "YES" ? yes.believerDelta : no.believerDelta;
    return {
      type: "losing_conviction",
      side,
      tier: TIER.losing_conviction,
      headline: `${side} is losing believers.`,
      detail: `${Math.abs(d)} ${plural(d, "believer", "believers")} left ${side}.`,
      evidence: [{ label: "Believers", value: `${d}` }],
      fingerprint: fp("losing_conviction", side),
    };
  };

  // Strict priority — a contradiction outranks a plain gain or acceleration.
  return (
    firstOf(peopleCapital) ??
    firstOf(concentration) ??
    firstOf(priceDivergence) ??
    marketDividing() ??
    tribeForming() ??
    acceleration() ??
    firstOf(broadening) ??
    losing()
  );
}
