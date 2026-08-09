import { describe, it, expect } from "vitest";
import {
  createScheduleState,
  enqueue,
  tick,
  modeFor,
  priorityOf,
  classifyPace,
  SCHEDULE,
  type PendingRow,
  type ScheduleState,
  type ReleasedRow,
} from "./feed-scheduler";

const T0 = Date.UTC(2026, 7, 4, 12, 0, 0);

const row = (o: Partial<PendingRow> & { id: string }): PendingRow => ({
  perishability: "soon",
  weight: 3,
  occurredAt: T0,
  enqueuedAt: T0,
  collapseKey: null,
  ...o,
});

/**
 * Run the scheduler forward, releasing whatever it will, and record WHEN each
 * row came out. Mirrors what a client does: tick, wait as told, tick again.
 */
function drain(
  state: ScheduleState,
  fromMs: number,
  untilMs: number,
): Array<{ at: number; released: ReleasedRow }> {
  const out: Array<{ at: number; released: ReleasedRow }> = [];
  let s = state;
  let t = fromMs;
  while (t <= untilMs) {
    const r = tick(s, t);
    s = r.state;
    if (r.release) out.push({ at: t, released: r.release });
    t += Math.max(50, r.nextTickMs);
  }
  return out;
}

describe("a poll response is not a frame", () => {
  it("does not animate eight simultaneous arrivals at once", () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      row({ id: `t${i}`, occurredAt: T0 + i * 1000 }),
    );
    const released = drain(enqueue(createScheduleState(T0), rows), T0, T0 + 60_000);
    expect(released).toHaveLength(8);
    // Every release is separated — nothing shares an instant with anything else.
    const times = released.map((r) => r.at);
    expect(new Set(times).size).toBe(8);
    for (let i = 1; i < times.length; i++) {
      expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(SCHEDULE.minGapMs);
    }
  });

  it("releases at most one row per tick, ever", () => {
    const rows = Array.from({ length: 20 }, (_, i) => row({ id: `t${i}` }));
    let s = enqueue(createScheduleState(T0), rows);
    for (let t = T0; t < T0 + 120_000; t += 500) {
      const r = tick(s, t);
      s = r.state;
      // `release` is a single row or null. The type enforces it; this asserts
      // the queue actually shrinks by the amount released and no more.
      if (r.release) expect(r.release.mergedCount).toBeGreaterThanOrEqual(1);
    }
    expect(s.queue).toHaveLength(0);
  });

  it("preserves chronological order inside a lane", () => {
    const rows = [
      row({ id: "c", occurredAt: T0 + 3000 }),
      row({ id: "a", occurredAt: T0 + 1000 }),
      row({ id: "b", occurredAt: T0 + 2000 }),
    ];
    const order = drain(enqueue(createScheduleState(T0), rows), T0, T0 + 60_000).map(
      (r) => r.released.id,
    );
    expect(order).toEqual(["a", "b", "c"]);
  });
});

describe("real activity is never intentionally held", () => {
  it("releases a `now` row at the animation floor, not the paced cadence", () => {
    const s = enqueue(createScheduleState(T0), [
      row({ id: "grp", perishability: "now", weight: 1 }),
    ]);
    // Nothing has been released yet, so the floor is already satisfied.
    expect(tick(s, T0).release?.id).toBe("grp");
  });

  it("group selling jumps a queue of ordinary trades", () => {
    const ordinary = Array.from({ length: 5 }, (_, i) => row({ id: `t${i}` }));
    let s = enqueue(createScheduleState(T0), ordinary);
    // One ordinary row goes out, then coordinated selling is learned of.
    const first = tick(s, T0);
    s = enqueue(first.state, [
      row({ id: "exodus", perishability: "now", weight: 1, enqueuedAt: T0 + 900 }),
    ]);
    // At the floor after the previous entrance, the coordinated move is next —
    // ahead of four ordinary trades that were queued before it.
    const next = tick(s, T0 + 900 + SCHEDULE.floorHoldMs[3]);
    expect(next.release?.id).toBe("exodus");
  });

  it("never holds a paced row past its bound", () => {
    const rows = Array.from({ length: 12 }, (_, i) => row({ id: `t${i}` }));
    const released = drain(enqueue(createScheduleState(T0), rows), T0, T0 + 300_000);
    for (const { at, released: r } of released) {
      expect(at - r.enqueuedAt).toBeLessThanOrEqual(SCHEDULE.maxHoldMs + SCHEDULE.minGapMs);
    }
  });

  it("tightens to the floor once the queue is behind reality", () => {
    const rows = Array.from({ length: 12 }, (_, i) => row({ id: `t${i}` }));
    let s = enqueue(createScheduleState(T0), rows);
    // Jump past the hold bound: everything queued is now overdue.
    const late = T0 + SCHEDULE.maxHoldMs + 1;
    const a = tick(s, late);
    s = a.state;
    expect(a.release).not.toBeNull();
    expect(a.nextTickMs).toBe(SCHEDULE.minGapMs);
  });
});

describe("a standing story is paced like any other unhurried row", () => {
  // It used to sit in a reserve lane the scheduler only opened after ten
  // seconds of silence, which meant a true, interesting thing could be withheld
  // indefinitely on a busy tape. It now competes on weight like everything else.
  const continuity = row({ id: "held43", perishability: "soon", weight: 2 });

  it("still yields to urgent activity, on priority alone", () => {
    const s = enqueue(createScheduleState(T0), [continuity, row({ id: "trade" })]);
    expect(modeFor(s, T0)).toBe("normal");
    expect(tick(s, T0 + 120_000).release?.id).toBe("trade");
  });

  it("is released on a quiet tape instead of being held for silence", () => {
    const s = enqueue(createScheduleState(T0), [continuity]);
    expect(tick(s, T0 + SCHEDULE.normal.toMs).release?.id).toBe("held43");
  });

  it("does not dump several of them back to back", () => {
    const many = Array.from({ length: 4 }, (_, i) =>
      row({ id: `c${i}`, perishability: "soon", weight: 2 }),
    );
    const s = enqueue(createScheduleState(T0), many);
    const released = drain(s, T0, T0 + 40_000);
    expect(released.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < released.length; i++) {
      expect(released[i]!.at - released[i - 1]!.at).toBeGreaterThanOrEqual(SCHEDULE.minGapMs);
    }
  });
});


/**
 * "A celebration must never delay a trade" is right in spirit and wrong at the
 * edge: taken literally it lets a $2 dust trade preempt a NEW TWIN, which is
 * importance losing to recency — the exact failure the significance work
 * exists to prevent. Urgency dominates, but weight spans a full rank.
 */
describe("preemption is by weight, not by lane alone", () => {
  it("puts the heaviest paced row level with the lightest immediate one", () => {
    const discovery = row({ id: "twin", perishability: "soon", weight: 1 });
    const dust = row({ id: "dust", perishability: "now", weight: 4 });
    expect(priorityOf(discovery)).toBe(priorityOf(dust));
  });

  it("still puts any material real event ahead of any standing fact", () => {
    const trade = row({ id: "trade", perishability: "now", weight: 4 });
    const best = row({ id: "cohort", perishability: "standing", weight: 1 });
    expect(priorityOf(trade)).toBeLessThan(priorityOf(best));
  });

  it("orders a heavy paced row ahead of a light one", () => {
    const s = enqueue(createScheduleState(T0), [
      row({ id: "small", weight: 4, occurredAt: T0 }),
      row({ id: "big", weight: 1, occurredAt: T0 + 5000 }),
    ]);
    // Later, but heavier — and weight wins inside the lane.
    expect(tick(s, T0 + 60_000).release?.id).toBe("big");
  });
});

/**
 * Below the animation floor a staggered entrance is indistinguishable from a
 * reload, so speed is not the answer to volume. One row saying seven is.
 */
describe("backpressure is collapse, not speed", () => {
  it("merges a run of near-identical rows into one", () => {
    const joins = Array.from({ length: 7 }, (_, i) =>
      row({ id: `j${i}`, collapseKey: "42:YES:enter", occurredAt: T0 + i * 100 }),
    );
    const released = drain(enqueue(createScheduleState(T0), joins), T0, T0 + 60_000);
    expect(released).toHaveLength(1);
    expect(released[0].released.mergedCount).toBe(7);
    expect(released[0].released.mergedIds).toHaveLength(7);
  });

  it("leaves a pair alone — two is not a crowd", () => {
    const pair = [
      row({ id: "a", collapseKey: "42:YES:enter" }),
      row({ id: "b", collapseKey: "42:YES:enter" }),
    ];
    const released = drain(enqueue(createScheduleState(T0), pair), T0, T0 + 60_000);
    expect(released).toHaveLength(2);
    expect(released.every((r) => r.released.mergedCount === 1)).toBe(true);
  });

  it("never releases faster than the animation floor, however deep the queue", () => {
    const rows = Array.from({ length: 60 }, (_, i) => row({ id: `t${i}` }));
    const released = drain(enqueue(createScheduleState(T0), rows), T0, T0 + 600_000);
    for (let i = 1; i < released.length; i++) {
      expect(released[i].at - released[i - 1].at).toBeGreaterThanOrEqual(SCHEDULE.minGapMs);
    }
  });
});

describe("rarity is legible in the pacing, not just the motion", () => {
  it("gives a heavy row a beat alone before anything else may move", () => {
    let s = enqueue(createScheduleState(T0), [
      row({ id: "tier1", weight: 1, occurredAt: T0 }),
      row({ id: "tier4", weight: 4, occurredAt: T0 + 1 }),
    ]);
    const first = tick(s, T0);
    expect(first.release?.id).toBe("tier1");
    s = first.state;
    // Inside the Tier 1 floor hold, nothing else is allowed to animate.
    expect(tick(s, T0 + SCHEDULE.floorHoldMs[1] - 100).release).toBeNull();
  });
});

describe("truth survives the scheduling", () => {
  it("carries occurredAt through untouched — display never sees a release time", () => {
    const happened = T0 - 3_600_000;
    const s = enqueue(createScheduleState(T0), [
      row({ id: "old", occurredAt: happened, enqueuedAt: T0 }),
    ]);
    const out = tick(s, T0 + 5000).release;
    expect(out?.occurredAt).toBe(happened);
  });

  it("never releases the same row twice", () => {
    let s = enqueue(createScheduleState(T0), [row({ id: "once" })]);
    const first = tick(s, T0);
    expect(first.release?.id).toBe("once");
    // The same row arrives again on the next poll — a reconcile overlap.
    s = enqueue(first.state, [row({ id: "once" })]);
    expect(s.queue).toHaveLength(0);
    expect(tick(s, T0 + 60_000).release).toBeNull();
  });

  it("ignores a row that is already queued", () => {
    const s = enqueue(createScheduleState(T0), [row({ id: "dup" })]);
    expect(enqueue(s, [row({ id: "dup" })]).queue).toHaveLength(1);
  });

  it("bounds what it remembers, so a long session cannot grow without limit", () => {
    let s = createScheduleState(T0);
    let t = T0;
    for (let i = 0; i < SCHEDULE.memory + 50; i++) {
      s = enqueue(s, [row({ id: `t${i}`, enqueuedAt: t })]);
      const r = tick(s, t);
      s = r.state;
      t += SCHEDULE.maxHoldMs;
    }
    expect(s.seen.length).toBeLessThanOrEqual(SCHEDULE.memory);
  });

  it("invents nothing — an empty queue releases nothing, forever", () => {
    const s = createScheduleState(T0);
    expect(drain(s, T0, T0 + 600_000)).toHaveLength(0);
    expect(modeFor(s, T0 + 600_000)).toBe("idle");
  });
});

describe("the cadence follows the day", () => {
  it("reads a deep queue as busy and a shallow one as normal", () => {
    const deep = enqueue(
      createScheduleState(T0),
      Array.from({ length: SCHEDULE.busyDepth }, (_, i) => row({ id: `t${i}` })),
    );
    expect(modeFor(deep, T0)).toBe("busy");
    expect(modeFor(enqueue(createScheduleState(T0), [row({ id: "one" })]), T0)).toBe("normal");
  });

  it("runs tighter when busy than when normal", () => {
    const busyRows = Array.from({ length: 10 }, (_, i) => row({ id: `b${i}` }));
    const busy = drain(enqueue(createScheduleState(T0), busyRows), T0, T0 + 30_000);
    // Two rows, so the mode stays normal and the cadence is the slower band.
    const calm = drain(
      enqueue(createScheduleState(T0), [row({ id: "c0" }), row({ id: "c1" })]),
      T0,
      T0 + 30_000,
    );
    const gap = (xs: Array<{ at: number }>) => xs[1].at - xs[0].at;
    expect(gap(busy)).toBeLessThan(gap(calm));
  });

  it("does not tick like a metronome", () => {
    const rows = Array.from({ length: 6 }, (_, i) => row({ id: `t${i}` }));
    const released = drain(enqueue(createScheduleState(T0), rows), T0, T0 + 60_000);
    const gaps = released.slice(1).map((r, i) => r.at - released[i].at);
    expect(new Set(gaps).size).toBeGreaterThan(1);
  });
});

/**
 * Urgency comes from what a row IS. The judgement in each case is "does waiting
 * forty seconds make this worse?"
 */
describe("classifyPace", () => {
  it("treats coordination as the thing you want to catch happening", () => {
    expect(classifyPace({ kind: "trade", action: "sweep_in" })).toBe("now");
    expect(classifyPace({ kind: "trade", action: "sweep_out" })).toBe("now");
  });

  it("treats a market opening and a structural shift as news that ages", () => {
    expect(classifyPace({ kind: "market_created" })).toBe("now");
    expect(classifyPace({ kind: "market_transition" })).toBe("now");
  });

  it("puts the reader's own move ahead of everything", () => {
    expect(classifyPace({ kind: "trade", action: "enter", isViewer: true })).toBe("now");
  });

  it("paces an ordinary trade", () => {
    expect(classifyPace({ kind: "trade", action: "enter" })).toBe("soon");
    expect(classifyPace({ kind: "position_changed_side" })).toBe("soon");
  });

  it("treats duration facts as standing, because they have no when", () => {
    expect(classifyPace({ kind: "conviction_cohort" })).toBe("standing");
    expect(classifyPace({ kind: "believer_milestone" })).toBe("standing");
    expect(classifyPace({ kind: "tribe_doubled" })).toBe("standing");
  });

  /**
   * The deliberate one. A discovery moment is the most important row the
   * product can show and among the least perishable — finding out you have a
   * Twin is equally true a minute later. Its WEIGHT already puts it ahead of
   * every ordinary trade; giving it urgency too would let it shove aside the
   * coordinated selling it has no claim to outrank.
   */
  it("makes a discovery moment important without making it urgent", () => {
    expect(classifyPace({ kind: "discovery_moment" })).toBe("soon");
    const discovery = {
      id: "d",
      perishability: "soon" as const,
      weight: 1,
      occurredAt: 0,
      enqueuedAt: 0,
    };
    const sweep = {
      id: "s",
      perishability: "now" as const,
      weight: 2,
      occurredAt: 0,
      enqueuedAt: 0,
    };
    // Coordination still goes first — but a discovery outranks any dust.
    expect(priorityOf(sweep)).toBeLessThan(priorityOf(discovery));
    const dust = {
      id: "x",
      perishability: "now" as const,
      weight: 4,
      occurredAt: 0,
      enqueuedAt: 0,
    };
    expect(priorityOf(discovery)).toBeLessThanOrEqual(priorityOf(dust));
  });
});

/**
 * A person's conviction count became true at a moment and then stays true — the
 * same shape as "someone has held YES for 43 days". Scheduling it as standing is
 * what lets a quiet stretch draw on it, which is the whole reason it exists.
 */
describe("a conviction count is a standing fact, not news that ages", () => {
  it("paces a person milestone with the other things that do not rot", () => {
    expect(classifyPace({ kind: "person_milestone" })).toBe("standing");
    expect(classifyPace({ kind: "conviction_cohort" })).toBe("standing");
  });

  it("still yields to the reader's own move", () => {
    expect(classifyPace({ kind: "person_milestone", isViewer: true })).toBe("now");
  });
});
