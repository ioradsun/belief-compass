/**
 * THE GATE between what the tape has fetched and what the reader sees.
 *
 * All the judgement — whether anyone is reading, how activity groups, what the
 * banner says — is in @/domain/tape-arrivals. This owns only the parts that
 * cannot be pure: the scroll and pointer listeners that say whether someone is
 * there, and the timer that coalesces a stream of events into one counter
 * change.
 *
 * THE SHAPE. `admitted` is what the tape renders. It only ever grows when the
 * reader is not reading, or when they tap the banner. Everything else waits in
 * `held`, and `pending` is how many updates that is after grouping.
 *
 * WHY THE ADMITTED LIST IS STATE AND NOT DERIVED: the whole point is that it
 * does NOT track the query. Deriving it would reintroduce the behaviour this
 * replaces — the list changing because a fetch landed rather than because a
 * person asked.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { TAPE, canAutoAdmit, groupArrivals, pendingCount, unseen } from "@/domain/tape-arrivals";
import type { Arrival } from "@/domain/tape-arrivals";

export interface TapeGate<T extends Arrival> {
  /** What to render. Grows on admit, never behind the reader's back. */
  admitted: T[];
  /** Updates waiting, after grouping. Zero hides the banner. */
  pending: number;
  /** Merge the held rows in and reset the counter. */
  admit: () => void;
  /** Increments on every admit that actually merged rows. */
  admitNonce: number;
  /**
   * Ids merged by the most recent tap. The render boundary PINS these so a tap
   * always changes what is on screen — otherwise a just-admitted row can lose
   * the ranked window (or sort into the past) and "Update" reads as a no-op.
   */
  lastAdmitted: string[];

  /** Attach to the tape's scroller so it can tell whether anyone is reading. */
  scrollRef: (el: HTMLElement | null) => void;
  /** Spread onto the tape's root: the pointer half of the same question. */
  pointerProps: {
    onPointerEnter: () => void;
    onPointerLeave: () => void;
  };
}

/**
 * @param resetKey identifies WHICH tape this is. When it changes — a different
 * market scope, a different wallet — the rows that arrive are not new activity,
 * they are a different list, and treating them as arrivals would leave the
 * previous market's rows on screen behind a banner offering this market's.
 */
export function useTapeGate<T extends Arrival>(
  incoming: readonly T[],
  resetKey?: string,
  /**
   * HOLD ALWAYS (the X model). New activity NEVER enters the visible list on
   * its own — not even when the reader is parked at the top. The mixer keeps
   * running in the background, arrivals queue, the counter climbs, and the
   * banner is the single action that merges them. Only the very first paint
   * admits itself, because a feed that starts empty behind a banner is not a
   * calm feed, it is a broken one.
   */
  holdAlways = false,
  /**
   * Collapse held rows to one per market before counting.
   *
   * True for the global feed, where twelve trades in one market inside three
   * seconds is one thing happening. FALSE for a tape already scoped to a single
   * market: there every row shares the same market id, so grouping would pin
   * the counter at "1 New" forever no matter how much activity arrived — the
   * reader would watch a number that never moves and conclude the feed is dead.
   */
  groupByMarket = true,
): TapeGate<T> {
  const [admitted, setAdmitted] = useState<T[]>([]);
  const [pending, setPending] = useState(0);
  const [admitNonce, setAdmitNonce] = useState(0);

  const heldRef = useRef<T[]>([]);
  // The mixer's latest, complete, freshly ranked output. Admitting REPLACES the
  // visible list with this rather than stitching queued rows on top, so the feed
  // the reader asked for is the feed the mixer would have produced.
  const incomingRef = useRef<readonly T[]>(incoming);
  incomingRef.current = incoming;
  const admittedRef = useRef<T[]>([]);
  admittedRef.current = admitted;

  // Engagement lives in refs, not state: it changes on every scroll frame and
  // re-rendering the tape because a pointer moved would be its own instability.
  const atTop = useRef(true);
  const pointerInside = useRef(false);
  const batchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A callback ref fires with the element and again with null on unmount, so
  // the previous listener is detached before a new one is attached. Without the
  // teardown every remount would leave one behind.
  const detach = useRef<(() => void) | null>(null);
  const scrollRef = useCallback((el: HTMLElement | null) => {
    detach.current?.();
    detach.current = null;
    if (!el) return;
    const read = () => {
      atTop.current = el.scrollTop <= TAPE.atTopPx;
    };
    read();
    el.addEventListener("scroll", read, { passive: true });
    detach.current = () => el.removeEventListener("scroll", read);
  }, []);

  const collapse = useCallback(
    <R extends Arrival>(rows: readonly R[]): R[] =>
      groupByMarket ? groupArrivals(rows) : [...rows],
    [groupByMarket],
  );

  const flushCount = useCallback(() => {
    batchTimer.current = null;
    setPending(groupByMarket ? pendingCount(heldRef.current) : heldRef.current.length);
  }, [groupByMarket]);

  // A different tape starts clean: no held rows to offer, no banner promising
  // the previous scope's activity, and the reader back at the top by definition.
  useEffect(() => {
    heldRef.current = [];
    setPending(0);
    setAdmitted([]);
    atTop.current = true;
  }, [resetKey]);

  useEffect(() => {
    const visible = new Set(admittedRef.current.map((r) => r.id));
    const heldIds = new Set(heldRef.current.map((r) => r.id));
    /**
     * AN UPDATE IS AN UPDATE.
     *
     * Anything the reader has not seen counts, whenever it happened. Timeline
     * order is how a tape reads while it sits still; it is NOT how arrival
     * works. When someone taps "N New" the rows they asked for go to the TOP —
     * that is the only place a person can watch them land. Ranking them back
     * into the past is what made the tap feel like nothing happened.
     */
    const fresh = unseen(incoming, visible).filter((r) => !heldIds.has(r.id));
    if (fresh.length === 0) return;

    const firstPaint = admittedRef.current.length === 0;
    const auto = firstPaint
      ? true
      : !holdAlways && canAutoAdmit({ atTop: atTop.current, pointerInside: pointerInside.current });
    if (auto) {
      // Nobody is reading — this is the live conversation working. Held rows go
      // in with them, so a reader who scrolls back to the top is not left with
      // a stale banner for updates that already arrived.
      const merged = [...fresh, ...heldRef.current];
      heldRef.current = [];
      setPending(0);
      setAdmitted((prev) => dedupe([...collapse(merged), ...prev]));
      return;
    }

    heldRef.current = [...fresh, ...heldRef.current];
    // The counter moves once per window, not once per event. A number ticking
    // 1 → 2 → 3 is movement too, and the reader is still being interrupted.
    if (batchTimer.current == null) batchTimer.current = setTimeout(flushCount, TAPE.batchMs);
  }, [incoming, flushCount, holdAlways, collapse]);

  useEffect(
    () => () => {
      if (batchTimer.current != null) clearTimeout(batchTimer.current);
      detach.current?.();
    },
    [],
  );

  const admit = useCallback(() => {
    if (batchTimer.current != null) {
      clearTimeout(batchTimer.current);
      batchTimer.current = null;
    }
    const taking = collapse(heldRef.current);
    heldRef.current = [];
    setPending(0);
    if (taking.length === 0) return;
    setAdmitNonce((n) => n + 1);
    setAdmitted((prev) =>
      // WHAT THEY ASKED FOR, FIRST. The admitted rows lead, then the mixer's
      // current ranking, then anything it has since dropped so nothing the
      // reader already saw disappears on a tap.
      dedupe([...taking, ...collapse(incomingRef.current as T[]), ...prev]),
    );
  }, [collapse]);

  return {
    admitted,
    pending,
    admit,
    admitNonce,
    scrollRef,
    pointerProps: {
      onPointerEnter: () => {
        pointerInside.current = true;
      },
      onPointerLeave: () => {
        pointerInside.current = false;
      },
    },
  };
}

/** First occurrence wins — the newest copy of a row is always at the front. */
function dedupe<T extends Arrival>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}
