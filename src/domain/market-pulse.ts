/**
 * PULSE — the market's one-word summary of what changed recently.
 *
 * The center is the Judge: it answers "is this question worth my conviction?"
 * without ever taking a side. Pulse is the headline of that answer — a single
 * neutral label plus the calm sentence that already explains the relationship
 * between people and money (vitalityStory). It is side-blind by construction and
 * can never contradict the totals, because it is derived from the same replayed
 * tape.
 *
 * ZERO IO, pure, fully testable.
 */
import { vitalityStory, type MarketVitality } from "./market-vitality";

/**
 * The honest states of a market's recent motion. Deliberately about CHANGE
 * (what just happened), never about which side is ahead.
 */
export type PulseLabel = "Quiet" | "Early" | "Growing" | "Accelerating" | "Deepening" | "Cooling";

const CAP_EPS = 1e-9;

/** The label for a market's current motion. */
export function pulseLabel(v: MarketVitality): PulseLabel {
  const events = v.believerEvents + v.capitalEvents;
  if (v.lastEventAt == null || events === 0) return "Quiet";
  // A brand-new market that is still finding its first handful of believers.
  if (v.range.kind === "since-creation" && v.believers <= 5) return "Early";

  const b = v.believersDelta;
  const c = v.capitalDeltaEth;
  const bUp = b > 0;
  const cUp = c > CAP_EPS;
  const bDown = b < 0;
  const cDown = c < -CAP_EPS;

  // Growth measured against its own starting base — a 6→12 week is "accelerating",
  // a 200→206 week is merely "growing".
  const bBase = Math.max(1, v.believers - b);
  const fast = bUp && cUp && b / bBase >= 0.5;

  if (fast) return "Accelerating";
  if (bUp && cUp) return "Growing";
  if (bUp) return "Growing"; // people arriving, capital flat
  if (!bUp && !bDown && cUp) return "Deepening"; // same people, more money
  if (bDown || cDown) return "Cooling";
  return "Quiet";
}

export interface MarketPulse {
  label: PulseLabel;
  /** The one calm sentence — never mentions a side, never uses hype. */
  meaning: string;
}

/** The full pulse: the label + the sentence that already reads the movement. */
export function marketPulse(v: MarketVitality): MarketPulse {
  return { label: pulseLabel(v), meaning: vitalityStory(v) };
}

/** Direction of a pulse, for the label's tint. */
export function pulseTone(label: PulseLabel): "up" | "down" | "flat" {
  if (label === "Growing" || label === "Accelerating" || label === "Deepening") return "up";
  if (label === "Cooling") return "down";
  return "flat";
}
