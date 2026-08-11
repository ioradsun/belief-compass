/**
 * WHAT THEY HELD BEFORE, AND WHAT THEY HOLD NOW — the two readings a closing
 * screen cannot be honest without.
 *
 * THE TRAP THIS EXISTS TO AVOID. The on-chain balance is one live value, and at
 * the instant a trade confirms it still reads PRE-TRADE — the contract read has
 * not refetched yet. A screen that treated it as "after" would tell somebody who
 * just bought their first YES that they hold nothing, and, far worse, would tell
 * a partial seller they were out.
 *
 * So the moment the action confirms, the current reading is frozen as BEFORE and
 * a refetch is issued. Until that refetch lands, `after` is NULL — not zero, not
 * the stale value. `resolvePostAction` has a specific branch for an unknown
 * balance ("Sale confirmed. Your position is updating.") and it can only reach it
 * if this hook refuses to guess.
 *
 * A FLIP NEEDS BOTH. "Your position flipped to NO" is a claim about a
 * transition, and a transition cannot be read from one number. Holding both
 * sides is not a change of mind; only `before` proves which it was.
 */
import { useEffect, useRef, useState } from "react";
import { useUserBalance } from "@/lib/chain-trade";
import type { Holdings } from "@/domain/post-action";

/** Shares are 18-decimal bigints; the screen only ever asks "any, or none". */
const asHoldings = (yes: bigint, no: bigint): Holdings => ({
  yes: Number(yes > 0n),
  no: Number(no > 0n),
});

export interface PositionShift {
  /** What they held when the action confirmed. Null before it did. */
  before: Holdings | null;
  /** What they hold now. NULL until the post-action read actually lands. */
  after: Holdings | null;
  /** The live balance hook's refetch, so callers keep one source. */
  refetch: () => void;
}

/**
 * @param active true once the action has confirmed — the edge that freezes
 *               `before` and triggers the re-read.
 */
export function usePositionShift(
  marketId: number | null,
  active: boolean,
  viewerWallet?: string | null,
): PositionShift {
  const bal = useUserBalance(marketId, viewerWallet);
  const before = useRef<Holdings | null>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!active) {
      // Reset for the next action rather than carrying one trade's before-state
      // into the next market the reader lands on.
      before.current = null;
      setSettled(false);
      return;
    }
    if (before.current != null) return;
    before.current = asHoldings(bal.yes, bal.no);
    /**
     * `refetch()` resolves whether or not the value changed, so `settled` marks
     * "we have asked again and heard back" rather than "the number moved". A
     * buy that leaves the holdings shape unchanged — more of a side already
     * held — must still count as settled, or the screen would wait forever.
     */
    void Promise.resolve(bal.refetch()).then(() => setSettled(true));
    // `bal` is a fresh object each render; the effect keys off the edge only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, marketId]);

  return {
    before: before.current,
    after: active && settled ? asHoldings(bal.yes, bal.no) : null,
    refetch: () => void bal.refetch(),
  };
}
