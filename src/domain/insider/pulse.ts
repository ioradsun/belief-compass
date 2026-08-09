/**
 * THE INSIDER PULSE (seam 3) — canonical market facts → InsiderPulse.
 *
 * "What does everything happening here MEAN?" — the aggregate read of one market,
 * the thing Market Insight (MarketVitality) explains in a sentence and the thing
 * that makes a Now story appear. ONE momentum computation, owning direction,
 * momentum, acceleration, activity, participation, capital flow, imbalance,
 * volatility, novelty.
 *
 * It COMPOSES the existing primitives rather than reinventing them, so there is
 * one definition of each concept:
 *   • shape (believers vs capital)  ← `pulseLabel` (src/domain/market-pulse)
 *   • "normal" activity / anomaly    ← `unusualness` / `dailyBaseline` (signal-vector)
 *   • price move as a fraction        ← `relativeMove` (signal-vector)
 * The only thing added here is the YES/NO DIRECTION and the normalization into the
 * shared 0..1 vocabulary. Pure, ZERO IO, deterministic.
 *
 * `PulseFacts` is a structural input aligned with `SignalFacts` + `PulseInput`;
 * the caller (market_state read) fills what it has. Missing inputs read as calm
 * (0 / BALANCED), never as invented movement.
 */
import { pulseLabel, type PulseLabel } from "../market-pulse";
import {
  relativeMove,
  unusualness,
  LOUD_REL_MOVE,
  UNUSUAL_FULL_RATIO,
} from "../signal-vector";
import type { InsiderPulse, InsiderPulseDirection } from "./types";

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);
const num = (n: number | null | undefined): number | null =>
  typeof n === "number" && Number.isFinite(n) ? n : null;

/**
 * Momentum tied to the SAME label the app already computes, so the number and the
 * word can never disagree (see market-pulse: "when words and numbers could
 * disagree, the numbers win" — here they are the same source).
 */
const MOMENTUM_BY_LABEL: Record<PulseLabel, number> = {
  New: 0,
  Quiet: 0.1,
  Cooling: 0.15,
  Narrowing: 0.25,
  "Mixed Momentum": 0.3,
  Growing: 0.5,
  Deepening: 0.6,
  Broadening: 0.6,
  "Capital-led": 0.7,
  Accelerating: 0.9,
};

/** Everything the pulse is allowed to read. Null ⇒ "not known", read as calm. */
export interface PulseFacts {
  // Shape (side-blind) — feeds the canonical pulse label.
  believerDelta: number;
  believerBase: number;
  believers: number;
  capitalDeltaEth: number;
  capitalBaseEth: number;
  events: number;
  // Direction (YES vs NO).
  believersYes?: number | null;
  believersNo?: number | null;
  capitalHeldYesEth?: number | null;
  capitalHeldNoEth?: number | null;
  // Activity / novelty.
  tradeCount24h?: number | null;
  tradeCount7d?: number | null;
  // Price move — volatility + acceleration.
  yesPrice?: number | null;
  yesPriceChange1h?: number | null;
  yesPriceChange24h?: number | null;
  // Recency.
  lastInterestingEventAt?: string | null;
}

/** Capital-weighted (then believer-weighted) YES share, or null when unknown. */
function yesShare(f: PulseFacts): number | null {
  const shares: number[] = [];
  const capYes = num(f.capitalHeldYesEth);
  const capNo = num(f.capitalHeldNoEth);
  if (capYes != null && capNo != null && capYes + capNo > 0) shares.push(capYes / (capYes + capNo));
  const bYes = num(f.believersYes);
  const bNo = num(f.believersNo);
  if (bYes != null && bNo != null && bYes + bNo > 0) shares.push(bYes / (bYes + bNo));
  if (shares.length === 0) return null;
  return shares.reduce((a, b) => a + b, 0) / shares.length;
}

function directionOf(share: number | null): InsiderPulseDirection {
  if (share == null) return "BALANCED";
  if (share > 0.55) return "YES";
  if (share < 0.45) return "NO";
  return "BALANCED";
}

export function insiderPulse(f: PulseFacts): InsiderPulse {
  const label = pulseLabel({
    believerDelta: f.believerDelta,
    believerBase: f.believerBase,
    believers: f.believers,
    capitalDeltaEth: f.capitalDeltaEth,
    capitalBaseEth: f.capitalBaseEth,
    events: f.events,
  });

  const u = unusualness(f.tradeCount24h, f.tradeCount7d);
  const activity = clamp01((u.ratio ?? 0) / UNUSUAL_FULL_RATIO);

  const rel1h = relativeMove(f.yesPriceChange1h, f.yesPrice);
  const rel24 = relativeMove(f.yesPriceChange24h, f.yesPrice);
  // The last hour vs the trailing 24h average hourly move. >0 ⇒ speeding up.
  const acceleration =
    rel1h != null && rel24 != null && rel24 > 0 ? clamp01((rel1h * 24 - rel24) / rel24) : 0;
  const volatility = rel24 != null ? clamp01(rel24 / LOUD_REL_MOVE) : 0;

  const participation = clamp01(f.believerDelta / Math.max(1, f.believerBase));
  const capitalFlow = clamp01(
    Math.abs(f.capitalDeltaEth) / Math.max(0.004, Math.abs(f.capitalBaseEth)),
  );

  const share = yesShare(f);

  return {
    direction: directionOf(share),
    momentum: MOMENTUM_BY_LABEL[label],
    acceleration,
    activity,
    participation,
    capitalFlow,
    imbalance: share == null ? 0 : clamp01(Math.abs(share - 0.5) * 2),
    volatility,
    novelty: u.value,
    lastInterestingEventAt: f.lastInterestingEventAt ?? null,
  };
}
