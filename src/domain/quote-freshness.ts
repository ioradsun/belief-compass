/**
 * THE NUMBER ON SCREEN AND THE NUMBER BEING SIGNED MUST BE THE SAME NUMBER.
 *
 * THE DEFECT. `useBuyQuote` reads `getTokensForETH` off the contract, the ticket
 * renders it ("≈ 412 shares at $0.61 avg"), and on confirm that exact value
 * becomes the transaction's slippage floor:
 *
 *     buy(marketId, yes, minOut(quotedTokens))   // minOut = quoted − 2%
 *
 * The quote has no freshness rule of its own. It inherits the app's global
 * `staleTime: 30_000` and nothing refetches it — no interval, no invalidation.
 * So it is read once when the amount settles and then sits there while the
 * reader does the thing this product is built to encourage: look at the
 * evidence, read the Case File, think about it. Confirm two minutes later and
 * the floor is derived from a two-minute-old reading of an AMM.
 *
 * WHY THE 2% TOLERANCE DOES NOT COVER THIS. That floor exists to absorb movement
 * between SIGNING and INCLUSION — a couple of Base blocks, a few seconds. It was
 * never sized for the gap between quoting and signing, which is unbounded and
 * set by human attention. Two failures follow, and they are different:
 *
 *   1. The price moved against the reader by more than 2% → the transaction
 *      REVERTS. They paid gas for nothing, having been shown a share count that
 *      was not achievable when they pressed the button. This is the same rule
 *      the affordability check exists for: never ask someone to sign something
 *      guaranteed to fail.
 *
 *   2. The price moved by less than 2% → the transaction succeeds and quietly
 *      delivers a different number of shares than the one they read. Not a
 *      disaster, but the screen made a promise the chain did not keep.
 *
 * AND THE EXPOSURE IS CORRELATED, not random. Platform-wide there are ~151
 * trades a day, so on a typical market nothing happens between quote and sign.
 * But the feed surfaces markets BECAUSE they are moving, so a reader is most
 * likely to be quoting exactly the markets where a quote goes stale fastest.
 * "Rare on average" is the wrong measure when the average is not who is exposed.
 *
 * THE RULE. Re-read the quote immediately before signing and sign against THAT.
 * Then compare it to what the reader was shown:
 *
 *   • within tolerance → proceed. The fresh floor is strictly safer than the
 *     stale one, and the reader gets what they were told, near enough.
 *   • outside tolerance → STOP and show them the new number. Their money, their
 *     decision, made against a figure that is actually true.
 *
 * TOLERANCE IS `DEFAULT_SLIPPAGE_BPS`, NOT A NEW CONSTANT. The product already
 * declares how much movement a reader implicitly accepts when they confirm; a
 * second threshold here would be a second answer to one question. Deliberately
 * reusing it also means the two can never drift apart.
 *
 * ZERO IO, pure, fully testable. The caller owns the chain read.
 */
import { DEFAULT_SLIPPAGE_BPS } from "@/domain/order";

/** How far below the shown quote the fresh one may land before we stop. */
export const QUOTE_DRIFT_TOLERANCE_BPS = DEFAULT_SLIPPAGE_BPS;

export type QuoteCheck =
  /** Close enough to what they were shown. Sign against `use`. */
  | { ok: true; use: bigint; driftBps: bigint }
  /**
   * Materially worse than what they were shown. Do not sign — say so, and let
   * them decide against the real number.
   */
  | { ok: false; reason: "moved"; shown: bigint; fresh: bigint; driftBps: bigint }
  /** The re-read failed or returned nothing usable. Blocks; never guesses. */
  | { ok: false; reason: "unavailable" };

/**
 * How far the fresh quote fell below the shown one, in basis points.
 *
 * A fresh quote that is BETTER returns 0 rather than a negative: this measures
 * how much worse the deal got, and "better than promised" is not a drift a
 * reader needs to approve.
 */
export function driftBps(shown: bigint, fresh: bigint): bigint {
  if (shown <= 0n) return 0n;
  if (fresh >= shown) return 0n;
  return ((shown - fresh) * 10_000n) / shown;
}

/**
 * Decide what to do with a re-read quote.
 *
 * `fresh` is null when the chain read failed. That BLOCKS — it does not fall
 * through to the stale value, because signing a floor we could not verify is
 * exactly the thing this module exists to stop. A check that switches itself off
 * when its input is missing is not a check (see domain/affordability).
 */
export function checkQuote(
  shown: bigint,
  fresh: bigint | null | undefined,
  toleranceBps: bigint = QUOTE_DRIFT_TOLERANCE_BPS,
): QuoteCheck {
  if (fresh == null || fresh <= 0n) return { ok: false, reason: "unavailable" };
  // Nothing was shown to contradict (a first quote, or a zero-amount ticket):
  // the fresh number is simply the number.
  if (shown <= 0n) return { ok: true, use: fresh, driftBps: 0n };
  const d = driftBps(shown, fresh);
  if (d > toleranceBps) return { ok: false, reason: "moved", shown, fresh, driftBps: d };
  return { ok: true, use: fresh, driftBps: d };
}

/** Basis points as a short percentage, for a sentence rather than a table. */
const pct = (bps: bigint): string => {
  const tenths = Number(bps) / 10;
  return `${(tenths / 10).toFixed(tenths % 10 === 0 ? 0 : 1)}%`;
};

/**
 * The render budget for a trade error.
 *
 * `OrderTicket` shows `trade.error.message.slice(0, 120)` — a truncation that
 * exists for a good reason (a raw wallet or RPC rejection can be a multi-line
 * dump that would wreck the ticket). It applies to OUR copy just the same, so
 * copy written past it does not get shown in full, it gets cut mid-sentence.
 * The test holds this line.
 */
export const QUOTE_COPY_BUDGET = 120;

/**
 * What the reader is told when the market moved out from under their quote.
 *
 * Never "failed" and never "error" — nothing failed, and nothing was sent. The
 * price moved, which is a normal thing for a market to do, and the only honest
 * next step is to show them the current number. Written tight enough that
 * `title. body` survives the truncation above intact.
 */
export function quoteMovedCopy(check: QuoteCheck): { title: string; body: string } | null {
  if (check.ok) return null;
  if (check.reason === "unavailable") {
    return {
      title: "Couldn't confirm the current price",
      // The problem is ours; do not imply their wallet or their money.
      body: "Nothing was sent. Try again in a moment.",
    };
  }
  return {
    title: "Price moved while you were deciding",
    body: `Now ~${pct(check.driftBps)} worse than your quote. Nothing was sent — check and confirm again.`,
  };
}

/** The one line the ticket actually renders. */
export function quoteMovedMessage(check: QuoteCheck): string | null {
  const c = quoteMovedCopy(check);
  return c ? `${c.title}. ${c.body}` : null;
}
