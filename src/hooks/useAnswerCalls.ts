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
import { useQueryClient } from "@tanstack/react-query";
import { answerCalls } from "@/lib/challenge.functions";

/** Where the just-closed callers wait for the panel that names them. */
export const closedCallsKey = (marketId: number) => ["calls-closed", marketId] as const;

/**
 * WHICH CALL THIS BUY ANSWERED — the link a relay hangs off.
 *
 * Parked beside the callers rather than inside them: the names are what a panel
 * PRINTS, this is what the next write POINTS AT, and folding a database id into
 * a list of people would make one of the two lie about what it is for.
 */
export const answeredCallKey = (marketId: number) => ["calls-answered", marketId] as const;

export function useAnswerCalls(
  wallet: string | undefined,
  marketId: number,
  /** A BUY has confirmed on-chain. Selecting a side is not an answer. */
  confirmed: boolean,
) {
  // Keyed by wallet+market rather than a bare boolean: the deck keeps its shell
  // mounted across market changes, so a `useRef(false)` reset by a separate
  // effect would race the confirmation on a fast swap.
  const qc = useQueryClient();
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!confirmed || !wallet || !Number.isFinite(marketId)) return;
    const key = `${wallet.toLowerCase()}:${marketId}`;
    if (done.current === key) return;
    done.current = key;
    /**
     * THE SERVER MAY NOT BE ABLE TO SEE THE POSITION YET.
     *
     * Answers are now PROVED server-side rather than taken on the client's word,
     * because "3 of 8 showed up" is a permanent claim about real people. But this
     * fires the instant the wallet confirms, which can precede the indexer writing
     * the event — so `pending` means "true, just not visible yet", and dropping it
     * would silently lose exactly the answers the feature exists for.
     *
     * A few bounded retries, not a poll: the gap is indexer lag measured in
     * seconds, and if it outlasts these the next page load tries again from a
     * clean guard. Nothing is lost either way — the stamp is idempotent.
     */
    const attempt = (left: number, waitMs: number) => {
      void answerCalls({ data: { wallet, marketId } })
        .then((r) => {
          // WHO was just answered, parked where the post-order panel can find it.
          // The panel is a sibling of the deck, not a child, so the cache is the
          // seam — and it is the same cache the panel already reads its reach from.
          if (r.closed.length > 0) {
            qc.setQueryData(closedCallsKey(marketId), r.closed);
            // The lineage travels with the names, so the relay offer beside them
            // can continue the chain rather than starting a parallel one.
            qc.setQueryData(answeredCallKey(marketId), { parentCall: r.parentCall });
          }
          if (r.pending && left > 0) {
            // Let the guard go, so a genuine retry is not mistaken for a repeat.
            done.current = null;
            setTimeout(() => {
              done.current = key;
              attempt(left - 1, waitMs * 2);
            }, waitMs);
          }
        })
        .catch(() => undefined);
    };
    attempt(3, 4000);
  }, [confirmed, wallet, marketId, qc]);
}
