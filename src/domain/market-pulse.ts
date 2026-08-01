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
  meaning: string;
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

/** The sentence that matches the label AND the exact directions. */
function pulseMeaning(label: PulseLabel, i: PulseInput): string {
  const capMove = Math.max(CAP_ABS, Math.abs(i.capitalBaseEth) * CAP_REL);
  const cUp = i.capitalDeltaEth > capMove;
  switch (label) {
    case "New":
      return "Conviction is just beginning to form.";
    case "Quiet":
      return "The market has held steady, with little moving either way.";
    case "Growing":
      return "More people are arriving, and commitment is holding.";
    case "Accelerating":
      return "More people are joining, and capital is following.";
    case "Deepening":
      return "The same believers are leaning in harder.";
    case "Broadening":
      return "Interest is spreading faster than the money behind it.";
    case "Mixed Momentum":
      return i.believerDelta > 0
        ? "More people are entering, but committed capital is getting lighter."
        : "Interest is holding, but committed capital is beginning to fade.";
    case "Narrowing":
      return cUp
        ? "Fewer people remain, but those still here are leaning in harder."
        : "Fewer people remain, though the committed capital is holding.";
    case "Cooling":
      return "Interest and committed capital are cooling together.";
    case "Capital-led":
      return "A small group is quietly increasing its commitment.";
  }
}

export function pulse(i: PulseInput): Pulse {
  const label = pulseLabel(i);
  return { label, meaning: pulseMeaning(label, i) };
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
