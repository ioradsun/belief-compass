/**
 * PULSE — the market narrator. One label + one calm sentence about the SHAPE of
 * momentum: how Market Believers and Market Capital are moving relative to each
 * other. Side-blind, price-free, and deterministic — when the words and the
 * numbers could disagree, the numbers win.
 *
 * ZERO IO, pure, fully testable.
 */
import type { MarketBook } from "./market-book";

export type PulseLabel =
  | "New"
  | "Quiet"
  | "Growing"
  | "Accelerating"
  | "Deepening"
  | "Broadening"
  | "Mixed Momentum"
  | "Narrowing"
  | "Cooling"
  | "Capital-led";

export interface Pulse {
  label: PulseLabel;
  /** One calm, observant sentence. Never a side, never price, never a number. */
  /**
   * The same read, compressed to a headline for the collapsed Market Signal
   * strip ("More believers. Less capital."). The full sentence lives inside the
   * Case File; this is the one-line version that fits above the order dock.
   */
  headline: string;
}

/** A capital move counts as real only past both an absolute and a relative floor. */
const CAP_ABS = 0.004; // ETH (~$12) — ignore dust
const CAP_REL = 0.03; // 3% of the base
/** Growth rates that separate "accelerating" and "capital-led" from "growing". */
const FAST = 0.25;
const BROADEN = 1.5;
const CAPITAL_LED = 0.25;

export interface PulseInput {
  believerDelta: number;
  believerBase: number;
  believers: number;
  capitalDeltaEth: number;
  capitalBaseEth: number;
  events: number;
}

/** The deterministic label. Reads the two deltas; the numbers are the authority. */
export function pulseLabel(i: PulseInput): PulseLabel {
  if (i.believers <= 1) return "New";

  const b = i.believerDelta;
  const c = i.capitalDeltaEth;
  const capMove = Math.max(CAP_ABS, Math.abs(i.capitalBaseEth) * CAP_REL);
  const cUp = c > capMove;
  const cDown = c < -capMove;
  const bUp = b > 0;
  const bDown = b < 0;

  if (i.events === 0) return "Quiet";
  if (!bUp && !bDown && !cUp && !cDown) return "Quiet";

  const bRate = b / Math.max(1, i.believerBase);
  const cRate = c / Math.max(capMove, Math.abs(i.capitalBaseEth));

  // Opposite directions, or one holding while the other fades → Mixed.
  if (bUp && cDown) return "Mixed Momentum";
  if (!bUp && !bDown && cDown) return "Mixed Momentum";

  // Believers falling.
  if (bDown && cDown) return "Cooling";
  if (bDown) return "Narrowing"; // capital rising or holding

  // Believers flat, capital rising.
  if (!bUp && cUp) return cRate >= CAPITAL_LED ? "Capital-led" : "Deepening";

  // Believers rising.
  if (bUp && cUp) {
    if (bRate >= FAST && cRate >= FAST) return "Accelerating";
    if (bRate >= cRate * BROADEN) return "Broadening";
    return "Growing";
  }
  return "Growing"; // people rising, capital flat
}

/** The read, in the app's voice: what the numbers mean, in one short line. */
function pulseHeadline(label: PulseLabel, i: PulseInput): string {
  const capMove = Math.max(CAP_ABS, Math.abs(i.capitalBaseEth) * CAP_REL);
  const cUp = i.capitalDeltaEth > capMove;
  switch (label) {
    case "New":
      return "Conviction just forming.";
    case "Quiet":
      return "Holding steady.";
    case "Growing":
      return "More believers. Steady capital.";
    case "Accelerating":
      return "More believers. More capital.";
    case "Deepening":
      return "Same believers. More capital.";
    case "Broadening":
      return "Believers outpacing capital.";
    case "Mixed Momentum":
      return i.believerDelta > 0
        ? "More believers. Less capital."
        : "Steady believers. Less capital.";
    case "Narrowing":
      return cUp ? "Fewer believers. More capital." : "Fewer believers. Steady capital.";
    case "Cooling":
      return "Fewer believers. Less capital.";
    case "Capital-led":
      return "Few believers. Rising capital.";
  }
}

export function pulse(i: PulseInput): Pulse {
  const label = pulseLabel(i);
  return { label, headline: pulseHeadline(label, i) };
}

/** Read the pulse straight off the canonical book (the center's source). */
export function marketPulse(book: MarketBook): Pulse {
  return pulse({
    believerDelta: book.believers.market.delta,
    believerBase: book.believers.market.base,
    believers: book.believers.market.current,
    capitalDeltaEth: book.capitalEth.market.delta,
    capitalBaseEth: book.capitalEth.market.base,
    events: book.believers.market.events + book.capitalEth.market.events,
  });
}

/** Direction of a pulse, for the label's tint. */
export function pulseTone(label: PulseLabel): "up" | "down" | "flat" {
  if (label === "Growing" || label === "Accelerating" || label === "Broadening") return "up";
  if (label === "Deepening" || label === "Capital-led") return "up";
  if (label === "Cooling" || label === "Narrowing") return "down";
  return "flat"; // New, Quiet, Mixed Momentum
}
