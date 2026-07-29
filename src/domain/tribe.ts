/**
 * Post-purchase belonging copy — pure, no IO.
 *
 * A completed buy is not a receipt; it's the moment a belief becomes a shared
 * identity. This maps the side + the market's CURRENT believer count to the
 * welcome the buyer sees. The numbers are only ever the count that already
 * exists on the market row — nothing here fabricates social proof or inflates a
 * small tribe. Small numbers are framed as EARLY, never as lonely.
 *
 * Tiers (from the count on the joined side):
 *   ≤ 1     — the first believer
 *   2 – 10  — one of the first believers
 *   11 – 99 — "{n} believers stand with you" · conviction is attracting others
 *   100+    — "{n} believers stand with you"
 */
import type { OrderSide } from "@/domain/order";

export interface TribeWelcome {
  /** The emotional anchor — "Welcome to the YES Tribe". */
  headline: string;
  /** One or two belonging lines shown under the headline. */
  message: string[];
  /** The single primary call-to-action label (always a share/invite verb). */
  cta: string;
}

const fmt = (n: number) => n.toLocaleString("en-US");

export function tribeWelcome(side: OrderSide, believers: number | null | undefined): TribeWelcome {
  const headline = `Welcome to the ${side} Tribe`;
  const n = Number.isFinite(Number(believers)) ? Math.max(0, Math.floor(Number(believers))) : 0;

  if (n <= 1) {
    return {
      headline,
      message: [
        "You're the first believer.",
        "Every tribe starts with someone willing to go first.",
      ],
      cta: "Invite the next believer",
    };
  }
  if (n <= 10) {
    return {
      headline,
      message: ["You're one of the first believers.", "Every tribe starts somewhere."],
      cta: "Grow the Tribe",
    };
  }
  if (n <= 99) {
    return {
      headline,
      message: [`${fmt(n)} believers stand with you.`, "Your conviction is attracting others."],
      cta: "Grow the Tribe",
    };
  }
  return {
    headline,
    message: [`${fmt(n)} believers stand with you.`],
    cta: "Share My Conviction",
  };
}

/**
 * The share invitation — identity, never finance. Deliberately carries NO
 * wallet, amount, PnL, average cost, or portfolio value: it invites a
 * conversation, it does not advertise a trade.
 */
export function tribeShareText(side: OrderSide): string {
  return `I joined ${side}. Conviction needs company — agree or disagree?`;
}
