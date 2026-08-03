/**
 * MARKET TRANSITION — the interpretation layer over already-computed facts.
 *
 * The side feed explains the FACTS of one side ("4 believers joined YES"). This
 * reads YES and NO together and names the MEANING for the whole market — the one
 * high-value state a neutral observer would call out:
 *
 *     More believers. Less capital.
 *     Capital is rising without broader participation.
 *     Price moved, but conviction did not.
 *     A Tribe is forming around YES.
 *     The market is becoming divided.
 *     NO is losing believers.
 *     YES is accelerating.
 *
 * It is NOT another scoring system. It reuses the feed-event trigger thresholds
 * (compositeSignal, FEED_TRIGGERS) and the metric-display rules, and interprets a
 * normalized snapshot of the per-side windows the rest of the app already builds.
 *
 * Two disciplines keep it calm:
 *   • PRIORITY — when several states are true, the most informative one wins
 *     (structural > contradiction > social > acceleration > directional), because
 *     a contradiction carries more information than a plain gain.
 *   • HYSTERESIS — a state has a strong ENTER bar and a looser EXIT bar (via the
 *     caller-supplied `prev`), so an interpretation doesn't flap on every trade.
 *
 * A `fingerprint` identifies the state (type + side) so callers can dedupe and
 * avoid repeating the same insight. Baseline-dependent claims ("4× normal") are
 * only made when a trustworthy baseline is supplied — never faked.
 *
 * ZERO IO, pure, fully testable.
 */
import { compositeSignal, FEED_TRIGGERS } from "./feed-event";
import { formatPct } from "./metric-display";

export type Side = "YES" | "NO";

export type TransitionType =
  | "market_dividing"
  | "people_capital_divergence"
  | "concentration_rising"
  | "price_conviction_divergence"
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
  accelerating: 2,
  losing_conviction: 3,
};

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

  // 1 — STRUCTURAL: both sides gaining believers, comparably → the market divides.
  {
    const enter = yes.believerDelta >= BEL && no.believerDelta >= BEL;
    // Hold while both are still adding (looser), so it doesn't drop on one quiet beat.
    const hold = yes.believerDelta >= 1 && no.believerDelta >= 1;
    if (held(prev, "market_dividing") ? hold : enter) {
      const min = Math.min(yes.believerDelta, no.believerDelta);
      const max = Math.max(yes.believerDelta, no.believerDelta);
      // Only "divided" when neither side dominates; a lopsided gain is directional.
      if (max === 0 || min / max >= 0.5) {
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
      }
    }
  }

  // 2 — CONTRADICTION: the most information is in a divergence. Evaluate the side
  // with the most capital action first for a deterministic pick.
  {
    const order: Side[] = dominantSide(input) === "YES" ? ["YES", "NO"] : ["NO", "YES"];
    for (const side of order) {
      const s = side === "YES" ? yes : no;
      const sig = compositeSignal({
        believerDelta: s.believerDelta,
        capitalDeltaUsd: s.capitalDeltaUsd,
        pricePct: s.pricePct ?? null,
      });
      // Hysteresis: keep an active divergence until the two metrics re-align.
      const stillDiverging =
        (s.believerDelta > 0 && s.capitalDeltaUsd < 0) ||
        (s.capitalDeltaUsd > 0 && s.believerDelta <= 0) ||
        ((s.pricePct ?? 0) >= FEED_TRIGGERS.price.minPct && s.believerDelta <= 0);

      if (
        sig === "people-up-capital-down" ||
        (held(prev, "people_capital_divergence", side) && stillDiverging && s.believerDelta > 0)
      ) {
        return {
          type: "people_capital_divergence",
          side,
          tier: TIER.people_capital_divergence,
          headline: "More believers. Less capital.",
          detail: `${side} added ${s.believerDelta} believer${s.believerDelta === 1 ? "" : "s"} while ${money(fmt, s.capitalDeltaUsd)} left.`,
          evidence: [
            { label: "Believers", value: `+${s.believerDelta}` },
            { label: "Capital", value: `−${money(fmt, s.capitalDeltaUsd)}` },
          ],
          fingerprint: fp("people_capital_divergence", side),
        };
      }
      if (
        sig === "capital-up-people-flat" ||
        (held(prev, "concentration_rising", side) && stillDiverging && s.capitalDeltaUsd > 0)
      ) {
        return {
          type: "concentration_rising",
          side,
          tier: TIER.concentration_rising,
          headline: "Capital is rising without broader participation.",
          detail: `${money(fmt, s.capitalDeltaUsd)} entered ${side}, but no new believers joined — the move is fewer wallets.`,
          evidence: [
            { label: "Capital", value: `+${money(fmt, s.capitalDeltaUsd)}` },
            { label: "Believers", value: `${s.believerDelta >= 0 ? "+" : ""}${s.believerDelta}` },
          ],
          fingerprint: fp("concentration_rising", side),
        };
      }
      if (
        sig === "price-up-people-flat" ||
        (held(prev, "price_conviction_divergence", side) && (s.pricePct ?? 0) >= ACCEL_EXIT)
      ) {
        return {
          type: "price_conviction_divergence",
          side,
          tier: TIER.price_conviction_divergence,
          headline: "Price moved, but conviction did not.",
          detail: `${side} re-rated ${formatPct(s.pricePct ?? 0)} with no new believers behind it.`,
          evidence: [
            { label: "Price", value: formatPct(s.pricePct ?? 0) },
            { label: "Believers", value: `${s.believerDelta >= 0 ? "+" : ""}${s.believerDelta}` },
          ],
          fingerprint: fp("price_conviction_divergence", side),
        };
      }
    }
  }

  // 3 — SOCIAL: a Tribe cluster forming on one side.
  if (social) {
    const forming: Side | null =
      social.tribeJoinedYes >= TRIBE_FORMING_MIN && social.tribeJoinedYes >= social.tribeJoinedNo
        ? "YES"
        : social.tribeJoinedNo >= TRIBE_FORMING_MIN
          ? "NO"
          : null;
    if (forming) {
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
    }
  }

  // 4 — ACCELERATION: only with a trustworthy baseline — never faked.
  if (baseline?.normalCapitalUsd != null && baseline.normalCapitalUsd > 0) {
    for (const side of ["YES", "NO"] as Side[]) {
      const s = side === "YES" ? yes : no;
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

  // 5 — DIRECTIONAL: a side clearly shedding believers.
  {
    const losing: Side | null =
      yes.believerDelta <= -BEL && yes.believerDelta <= no.believerDelta
        ? "YES"
        : no.believerDelta <= -BEL
          ? "NO"
          : null;
    if (losing) {
      const d = losing === "YES" ? yes.believerDelta : no.believerDelta;
      return {
        type: "losing_conviction",
        side: losing,
        tier: TIER.losing_conviction,
        headline: `${losing} is losing believers.`,
        detail: `${Math.abs(d)} believer${Math.abs(d) === 1 ? "" : "s"} left ${losing}.`,
        evidence: [{ label: "Believers", value: `${d}` }],
        fingerprint: fp("losing_conviction", losing),
      };
    }
  }

  return null;
}
