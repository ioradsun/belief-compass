/**
 * useScheduledRows — the bridge between "what the server says is true" and
 * "what the reader sees appear".
 *
 * The tape used to render whatever the last poll returned, which meant eight
 * events that happened across thirty seconds all animated in the same frame.
 * That is a page refresh wearing a transition. Here the rows go through
 * src/domain/feed-scheduler instead, and come out one at a time.
 *
 * THE FIRST PAINT IS NOT A STREAM. Everything already on screen when the tape
 * mounts is shown at once, with no animation and no dripping — a reader opening
 * the page wants the last few hours immediately, not forty rows metered out
 * over two minutes. Only what arrives AFTER that is scheduled. This is the same
 * rule the old arrival animation used, for the same reason.
 *
 * NOTHING IS EVER WITHHELD PERMANENTLY. The scheduler bounds every hold, and if
 * this hook is unmounted mid-queue the rows are not lost — they come back on the
 * next fetch, because the queue is a presentation detail and the query cache is
 * the truth. Held rows keep their real `occurredAt`; the release time exists
 * only in this hook and is never displayed or stored.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createScheduleState,
  enqueue,
  tick,
  type PendingRow,
  type ScheduleState,
} from "@/domain/feed-scheduler";

/** The minimum a row must carry to be scheduled. */
export interface SchedulableRow {
  id: string;
  occurredAt: string;
  pace?: { perishability: PendingRow["perishability"]; weight: number } | null;
}

export interface ScheduledView<T> {
  /** The rows the reader may see, in the order they were given. */
  rows: T[];
  /** Weight of each row that entered via the scheduler — drives its motion. */
  entranceWeight: (id: string) => number | null;
  /** How many rows are waiting. Non-zero means the tape is mid-release. */
  pending: number;
}

/** Ids whose entrance has already played. Bounded so a long session cannot grow. */
const ENTRANCE_MEMORY = 200;

/** Stable identity for the default, so it never re-triggers the reserve effect. */
const EMPTY: never[] = [];

/**
 * @param resetKey Identifies WHICH tape this is. Changing it starts over: a
 *   reader switching market is not watching a stream arrive, they are opening a
 *   new page, and dripping the new market's history in one row at a time would
 *   be the loading animation this hook exists to avoid.
 */
export function useScheduledRows<T extends SchedulableRow>(
  all: T[],
  resetKey?: string,
  reserve: T[] = EMPTY,
  /**
   * REVEAL ON DEMAND. Changing this number means the reader ASKED for the
   * waiting rows (they tapped "N New"). A drip is the right answer for activity
   * nobody requested; it is the wrong answer for a direct request, where the
   * rows must land at once, at the top, with a visible entrance — otherwise the
   * tap appears to do nothing and the updates seem to vanish.
   */
  revealKey = 0,
): ScheduledView<T> {

  const [shown, setShown] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [pending, setPending] = useState(0);

  const state = useRef<ScheduleState>(createScheduleState(Date.now()));
  /** Every id we have already decided about — shown, queued, or collapsed away. */
  const known = useRef<Set<string>>(new Set());
  const painted = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entrances = useRef<Map<string, number>>(new Map());

  /**
   * Run the scheduler until it has nothing due, then sleep exactly as long as
   * it asked. A fixed interval would either burn frames on an idle tape or miss
   * the cadence on a busy one; the scheduler already knows when it next matters.
   */
  const pump = useCallback(() => {
    if (timer.current != null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const run = () => {
      const res = tick(state.current, Date.now());
      state.current = res.state;
      if (res.release) {
        const { id, weight } = res.release;
        entrances.current.set(id, weight);
        if (entrances.current.size > ENTRANCE_MEMORY) {
          // Oldest first — insertion order is arrival order.
          const oldest = entrances.current.keys().next().value;
          if (oldest != null) entrances.current.delete(oldest);
        }
        setShown((prev) => new Set(prev).add(id));
      }
      setPending(state.current.queue.length);
      timer.current =
        state.current.queue.length > 0 ? setTimeout(run, Math.max(50, res.nextTickMs)) : null;
    };
    run();
  }, []);

  // A different tape entirely. Drop everything and let the next batch paint
  // whole, exactly as a first load does.
  const scope = useRef(resetKey);
  if (scope.current !== resetKey) {
    scope.current = resetKey;
    painted.current = false;
    known.current = new Set();
    entrances.current = new Map();
    state.current = createScheduleState(Date.now());
    if (timer.current != null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }

  useEffect(() => {
    const fresh = all.filter((r) => !known.current.has(r.id));
    if (fresh.length === 0) return;

    // The first non-empty batch IS the page as the reader finds it. Show it
    // whole; scheduling it would be a loading animation pretending to be life.
    if (!painted.current) {
      painted.current = true;
      for (const r of all) known.current.add(r.id);
      setShown(new Set(all.map((r) => r.id)));
      // The activity clock starts here, so a tape that opens quiet does not
      // immediately think it has been silent for long enough to celebrate.
      state.current = createScheduleState(Date.now());
      return;
    }

    const now = Date.now();
    for (const r of fresh) known.current.add(r.id);
    state.current = enqueue(
      state.current,
      fresh.map(
        (r): PendingRow => ({
          id: r.id,
          perishability: r.pace?.perishability ?? "soon",
          weight: r.pace?.weight ?? 3,
          occurredAt: Date.parse(r.occurredAt),
          enqueuedAt: now,
          // Bursts are already collapsed upstream by `groupLiveRows`, which can
          // see the whole event log rather than one poll's worth. A second
          // collapse here could only merge rows the server deliberately kept
          // apart, and the row's own sentence could not honestly say so.
          collapseKey: null,
        }),
      ),
    );
    pump();
  }, [all, pump]);

  // THE RESERVE. Standing facts are never shown on first paint and never
  // compete with the timeline: they go straight into the scheduler's queue, and
  // it draws one only once the silence is real. Enqueued even before the first
  // paint, so a tape that opens quiet has something to say when it stays quiet.
  useEffect(() => {
    const fresh = reserve.filter((r) => !known.current.has(r.id));
    if (fresh.length === 0) return;
    const now = Date.now();
    for (const r of fresh) known.current.add(r.id);
    state.current = enqueue(
      state.current,
      fresh.map(
        (r): PendingRow => ({
          id: r.id,
          perishability: "standing",
          weight: r.pace?.weight ?? 3,
          // A standing fact has no "when"; this only orders it within its own
          // lane and is never rendered.
          occurredAt: Date.parse(r.occurredAt) || 0,
          enqueuedAt: now,
          collapseKey: null,
        }),
      ),
    );
    pump();
  }, [reserve, pump]);

  // THE READER ASKED. Everything known — queued, held back, just merged — is
  // released in one commit, and each newly visible row is given the major
  // entrance so the answer to "where did they go?" is a thing you can watch.
  const allRef = useRef(all);
  allRef.current = all;
  const revealed = useRef(revealKey);
  useEffect(() => {
    if (revealed.current === revealKey) return;
    revealed.current = revealKey;
    const rows = allRef.current;
    if (rows.length === 0) return;
    setShown((prev) => {
      const next = new Set(prev);
      for (const r of rows) {
        known.current.add(r.id);
        if (!next.has(r.id)) {
          next.add(r.id);
          entrances.current.set(r.id, 1);
        }
      }
      return next;
    });
    if (timer.current != null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    state.current = createScheduleState(Date.now());
    setPending(0);
  }, [revealKey]);


  useEffect(
    () => () => {
      if (timer.current != null) clearTimeout(timer.current);
    },
    [],
  );

  return {
    // A released standing fact renders at the top: it has no time of its own,
    // and the moment it was drawn is the only ordering it can honestly have.
    rows: [...reserve.filter((r) => shown.has(r.id)), ...all.filter((r) => shown.has(r.id))],
    entranceWeight: (id: string) => entrances.current.get(id) ?? null,
    pending,
  };
}
