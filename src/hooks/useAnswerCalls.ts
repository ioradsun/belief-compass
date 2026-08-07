/**
 * A CONFIRMED BUY CLOSES EVERY OPEN CALL IN THAT MARKET.
 *
 * This is the one write that keeps Challenge from lying. Open Challenges are
 * DERIVED — `buildChallenges` recomputes them from `events` on every read — so
 * the panel would drop an answered row on its own the moment the viewer's trade
 * lands in `events`. The stamp is not what removes the row.
 *
 * What the stamp is for is Dependability: the record that this person, called by
 * that person, in that relationship, actually showed up. That is not
 * reconstructible later. `relation_at_call` was frozen when the call was made,
 * and by the time anyone asks "does Sarah answer her Twins?" the DNA engine may
 * have reclassified everyone involved. Miss the stamp and the answer is gone —
 * silently, with the panel still behaving perfectly.
 *
 * IT LIVES IN A HOOK BECAUSE THERE ARE TWO BUY SURFACES. `MarketDeck` (desktop)
 * and `MobileGame` (phone) run the same `trade.isSuccess && hash && side`
 * effect, and a rule copied into both is a rule that will be updated in one.
 *
 * FIRE-AND-FORGET, ALWAYS. The Conviction Reveal paints from `trade.isSuccess`
 * and must never wait on — or be withheld by — a bookkeeping write. The server
 * side is idempotent (`responded_at IS NULL`), so a retry, a re-render or a
 * second trade in the same market changes nothing already recorded.
 */
import { useEffect, useRef } from "react";
import { answerCalls } from "@/lib/challenge.functions";

export function useAnswerCalls(
  wallet: string | undefined,
  marketId: number,
  /** A BUY has confirmed on-chain. Selecting a side is not an answer. */
  confirmed: boolean,
) {
  // Keyed by wallet+market rather than a bare boolean: the deck keeps its shell
  // mounted across market changes, so a `useRef(false)` reset by a separate
  // effect would race the confirmation on a fast swap.
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!confirmed || !wallet || !Number.isFinite(marketId)) return;
    const key = `${wallet.toLowerCase()}:${marketId}`;
    if (done.current === key) return;
    done.current = key;
    void answerCalls({ data: { wallet, marketId } }).catch(() => undefined);
  }, [confirmed, wallet, marketId]);
}
