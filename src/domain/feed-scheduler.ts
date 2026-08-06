/**
 * FEED SCHEDULER — when a true thing gets said, and in what order.
 *
 * Ingestion decides WHAT is true. This decides WHEN the reader sees it. They are
 * separate systems on purpose: rendering a whole poll response into one React
 * frame is what makes a live tape read as a page refresh instead of a stream,
 * and no amount of easing fixes that. It is a scheduling problem.
 *
 * THE ONE RULE: real activity interrupts, standing facts fill silence.
 *
 * TWO AXES, NOT THREE LANES. An earlier design sorted events into immediate /
 * paced / reservoir, which quietly collapsed two independent questions into one
 * answer and then tripped over the collision — a NEW TWIN discovery is the most
 * IMPORTANT thing that can happen and among the least URGENT, because it is
 * equally true forty seconds from now. So:
 *
 *   PERISHABILITY  how fast does this stop being worth saying?   → when
 *   WEIGHT         how much of the reader's attention is it owed? → how
 *
 * Perishability picks the lane. Weight picks the motion, the preemption rank,
 * and how long a row holds the floor before anything else may move.
 *
 *   · "now"      Coordinated buying or selling, a market opening, the viewer's
 *                own action, major capital movement. These arrive over the
 *                realtime socket and are never intentionally held.
 *   · "soon"     Ordinary trades, price moves, network activity. Released in
 *                sequence so simultaneous arrivals do not look like a reload.
 *                Never held past `maxHoldMs`.
 *   · "standing" Someone has held YES for 43 days. True now, true tomorrow,
 *                true next week — it has no "when" at all. Drawn only during
 *                genuine silence, and never allowed to delay real activity.
 *
 * WHY STANDING FACTS DO NOT EXPIRE. Treating them as events with a maximum age
 * creates the staleness it then has to manage: a queue of celebrations drains
 * and leaves you empty again, which is exactly the dead feed this exists to
 * prevent. A standing fact is not aging, so the correct control is a per-reader
 * COOLDOWN on repeating the same fact — the caller's job, since only it knows
 * who is reading. This module simply never invents one and never lets one
 * outrank real activity.
 *
 * PREEMPTION IS BY WEIGHT, NOT BY LANE. "A celebration must never delay a
 * trade" sounds right and is wrong at the edges: it lets a $2 dust trade
 * preempt a NEW TWIN, which is importance losing to recency — the precise
 * failure the significance work exists to prevent. Priority blends both axes so
 * urgency dominates but the heaviest paced row can still tie the lightest
 * immediate one.
 *
 * BACKPRESSURE IS COLLAPSE, NOT SPEED. "Accelerate rather than dump" has a hard
 * floor: below `minGapMs` a staggered entrance is indistinguishable from a
 * refresh, so you have rebuilt the problem with extra machinery. Under pressure
 * the answer is one row saying "7 believers joined YES", not seven rows at
 * 100ms apart.
 *
 * And the pacing that remains is ANTICIPATORY. Reacting only once a row is
 * already overdue is how a queue gets permanently behind — the rows released
 * while there was still slack are the ones that spent it. So the cadence is
 * derived from what it would take to drain the paced queue before its oldest
 * member breaches its bound, which tightens smoothly rather than flipping.
 *
 * TRUTH IS NOT NEGOTIABLE. `occurredAt` is when it happened and is the only
 * thing a timestamp may ever be rendered from. The release time is a
 * presentation fact, per-reader and per-session; it is never persisted and
 * never displayed. Nothing here fabricates an event, and nothing here can make
 * a row claim to be newer than it is.
 *
 * ZERO IO, pure, deterministic (including the jitter), fully testable.
 */

export type Perishability = "now" | "soon" | "standing";

/** busy → normal → quiet → idle, by how much real activity is waiting. */
export type SchedulerMode = "busy" | "normal" | "quiet" | "idle";

export const SCHEDULE = {
  /**
   * The floor between two entrances. An entrance takes 220ms and an eye needs
   * time to register a row; below roughly this, staggering stops reading as
   * "arriving one at a time" and starts reading as a reload. Even a "now" row
   * waits this long — that is the animation floor, not an intentional delay.
   */
  minGapMs: 700,
  /** Several economic events waiting: keep up, but still one at a time. */
  busy: { fromMs: 1_500, toMs: 3_000 },
  /** The ordinary rhythm. */
  normal: { fromMs: 3_000, toMs: 6_000 },
  /** Silence. One standing fact, unhurried, and never two in a row quickly. */
  quiet: { fromMs: 15_000, toMs: 30_000 },
  /** Real rows pending at which the cadence tightens. */
  busyDepth: 4,
  /** Silence this long before a standing fact may be drawn at all. */
  // TWENTY SECONDS. At 45s a tape only reached `quiet` on a genuinely dead
  // market, so the reserve built on every fetch was rarely drawn and slow
  // periods read as broken rather than calm. Twenty seconds of nothing is
  // already a silence a reader notices.
  quietAfterMs: 20_000,
  /**
   * The longest a "soon" row may be held. Past this the queue is behind reality
   * and the cadence drops to the floor — a feed that is pleasant and wrong is
   * worse than one that is brisk and right.
   */
  maxHoldMs: 15_000,
  /**
   * How long a released row holds the floor before the next may animate,
   * indexed by weight (1 heaviest … 4 texture). This is what makes rarity
   * legible: a Tier 1 row gets a beat alone, a Tier 4 row gets none.
   */
  floorHoldMs: [0, 1_400, 900, 700, 0],
  /** Rows sharing a collapse key merge into one at or above this count. */
  collapseMin: 3,
  /** How many released ids to remember for dedup. Bounded on purpose. */
  memory: 400,
} as const;

/**
 * How urgent a row is, from what it IS. Kept here so the one rule lives with
 * the thing that obeys it, and so it can be tested without a database.
 *
 * The judgement in each case is "does waiting forty seconds make this worse?"
 *
 *   · A coordinated move, a market opening, the reader's own trade — yes,
 *     badly. These are the moments where a feed either feels live or does not.
 *   · An ordinary trade — a little. Enough to be paced, not enough to interrupt.
 *   · Someone has held a belief for 43 days — not at all. It is not news that
 *     is aging; it is a fact that is standing.
 *
 * A DISCOVERY MOMENT IS DELIBERATELY NOT "now". It is the most important row
 * the product can show and among the least perishable — finding out you have a
 * Twin is equally true a minute later. Its weight (Tier 1) already puts it
 * ahead of every ordinary trade; giving it urgency as well would let it shove
 * aside the coordinated selling it has no claim to outrank.
 */
export function classifyPace(input: {
  kind: string;
  /** The conviction grammar's action, when the row has one. */
  action?: string | null;
  /** True when the reader is the actor. Nothing is more urgent than your own move. */
  isViewer?: boolean;
}): Perishability {
  if (input.isViewer) return "now";
  switch (input.kind) {
    // Standing facts: true today, true tomorrow, no "when" of their own.
    //
    // `person_milestone` is the same shape as the rest: a conviction count
    // became true at a moment and then stays true. Scheduling it as standing is
    // what lets the quiet stretches draw on it, which is why it exists.
    case "conviction_cohort":
    case "believer_milestone":
    case "tribe_doubled":
    case "person_milestone":
      return "standing";
    // A market opening is the one piece of news that is only news once.
    case "market_created":
      return "now";
    // A structural change in where the capital or the believers sit.
    case "market_transition":
      return "now";
    default:
      // One wallet moving across many markets at once is coordination, and
      // coordination is the thing a reader most wants to catch while it is
      // happening rather than read about afterwards.
      return input.action === "sweep_in" || input.action === "sweep_out" ? "now" : "soon";
  }
}

export interface PendingRow {
  /** Stable identity — the event's id or source_key. Dedup keys on this. */
  id: string;
  perishability: Perishability;
  /** 1 (heaviest) … 4 (texture). The tier `scoreFeedEvent` already computes. */
  weight: number;
  /** When it actually happened. Display reads this and only this. */
  occurredAt: number;
  /** When this client learned of it. Drives hold limits, never display. */
  enqueuedAt: number;
  /** Rows sharing a non-null key may merge under pressure. */
  collapseKey?: string | null;
}

export interface ReleasedRow extends PendingRow {
  /** Every id this row now speaks for, including its own. */
  mergedIds: string[];
  /** 1 when nothing collapsed. Above 1, the row should say so. */
  mergedCount: number;
}

export interface ScheduleState {
  queue: PendingRow[];
  /** When the last row was released. */
  lastReleaseAt: number;
  /** Weight of the last released row — sets how long the floor is held. */
  lastWeight: number;
  /** When real (non-standing) activity was last released. Gates quiet mode. */
  lastActivityAt: number;
  /** Ids already released, newest last. Bounded to SCHEDULE.memory. */
  seen: string[];
}

export interface TickResult {
  state: ScheduleState;
  mode: SchedulerMode;
  /** At most ONE row per tick. Only one thing may move at a time. */
  release: ReleasedRow | null;
  /** How long until this is worth calling again. */
  nextTickMs: number;
}

export function createScheduleState(nowMs: number): ScheduleState {
  return { queue: [], lastReleaseAt: 0, lastWeight: 4, lastActivityAt: nowMs, seen: [] };
}

const PERISH_RANK: Record<Perishability, number> = { now: 0, soon: 1, standing: 2 };

const clampWeight = (w: number): number => (w < 1 ? 1 : w > 4 ? 4 : Math.round(w));

/**
 * Lower is sooner. Perishability dominates, but weight spans a full rank — so
 * the heaviest paced row ties the lightest immediate one, and a discovery
 * moment is never shoved aside by a dust trade that merely arrived first.
 */
export function priorityOf(r: PendingRow): number {
  return PERISH_RANK[r.perishability] * 3 + (clampWeight(r.weight) - 1);
}

/**
 * Deterministic jitter. A perfectly regular cadence is the tell that something
 * is mechanical rather than alive, but a real RNG would make this untestable —
 * so the wobble is derived from the row's own id. Same row, same feel, every
 * run.
 */
function spread(seed: string, from: number, to: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const span = Math.max(1, to - from + 1);
  return from + (Math.abs(h) % span);
}

/** Add newly-learned rows. Anything already queued or already shown is dropped. */
export function enqueue(state: ScheduleState, rows: PendingRow[]): ScheduleState {
  if (rows.length === 0) return state;
  const known = new Set([...state.seen, ...state.queue.map((r) => r.id)]);
  const fresh = rows.filter((r) => !known.has(r.id));
  if (fresh.length === 0) return state;
  return { ...state, queue: [...state.queue, ...fresh] };
}

const isReal = (r: PendingRow) => r.perishability !== "standing";

/** The oldest hold on a "soon" row, in ms. 0 when nothing is waiting. */
function longestHold(queue: PendingRow[], nowMs: number): number {
  let worst = 0;
  for (const r of queue) {
    if (r.perishability !== "soon") continue;
    const held = nowMs - r.enqueuedAt;
    if (held > worst) worst = held;
  }
  return worst;
}

export function modeFor(state: ScheduleState, nowMs: number): SchedulerMode {
  const real = state.queue.filter(isReal).length;
  if (real >= SCHEDULE.busyDepth) return "busy";
  if (real > 0) return "normal";
  const silentFor = nowMs - state.lastActivityAt;
  const hasStanding = state.queue.some((r) => !isReal(r));
  if (hasStanding && silentFor >= SCHEDULE.quietAfterMs) return "quiet";
  return "idle";
}

/**
 * How long before the next entrance may play.
 *
 * The cadence is ANTICIPATORY, not reactive. Waiting until a row is already
 * overdue and only then sprinting is how a queue ends up permanently behind:
 * the rows released while there was still slack used up the slack. So the pace
 * is derived from what it would take to drain the paced queue before its OLDEST
 * member breaches its bound — which tightens smoothly as the queue deepens or
 * ages, and bottoms out at the animation floor rather than dumping.
 */
function gapFor(
  queue: PendingRow[],
  mode: SchedulerMode,
  next: PendingRow,
  lastWeight: number,
  nowMs: number,
): number {
  const floor = Math.max(SCHEDULE.minGapMs, SCHEDULE.floorHoldMs[clampWeight(lastWeight)] ?? 0);
  // A "now" row is never intentionally held. It still cannot overlap the
  // entrance already playing, which is the animation floor, not a delay.
  if (next.perishability === "now") return floor;

  const band =
    mode === "busy" ? SCHEDULE.busy : mode === "quiet" ? SCHEDULE.quiet : SCHEDULE.normal;
  const wanted = spread(next.id, band.fromMs, band.toMs);
  // Standing facts have no bound to breach — silence is exactly where they
  // belong, and hurrying them would defeat the point.
  if (next.perishability === "standing") return Math.max(floor, wanted);

  const waiting = queue.filter((r) => r.perishability === "soon").length;
  if (waiting === 0) return Math.max(floor, wanted);
  const headroom = SCHEDULE.maxHoldMs - longestHold(queue, nowMs);
  // Already breached: nothing left to budget, go at the floor.
  if (headroom <= 0) return floor;
  return Math.max(floor, Math.min(wanted, headroom / waiting));
}

/**
 * The next row to say, ignoring timing. Highest priority, then oldest — so
 * rows within a lane come out in the order they happened and the tape reads
 * chronologically even though it renders newest-first.
 */
function nextUp(queue: PendingRow[], mode: SchedulerMode): PendingRow | null {
  const eligible = queue.filter((r) => (isReal(r) ? true : mode === "quiet"));
  if (eligible.length === 0) return null;
  return [...eligible].sort(
    (a, b) =>
      priorityOf(a) - priorityOf(b) || a.occurredAt - b.occurredAt || (a.id < b.id ? -1 : 1),
  )[0];
}

/**
 * Everything that should go out as one row with `head`. Collapse is the real
 * backpressure: when a market produces seven near-identical joins, the honest
 * and readable answer is one row that says seven, not seven rows racing.
 */
function collapseWith(head: PendingRow, queue: PendingRow[]): PendingRow[] {
  if (!head.collapseKey) return [head];
  const group = queue.filter((r) => r.collapseKey === head.collapseKey);
  return group.length >= SCHEDULE.collapseMin ? group : [head];
}

/**
 * Advance the scheduler. Releases at most one row — the whole point is that
 * exactly one thing moves at a time, so importance stays legible.
 */
export function tick(state: ScheduleState, nowMs: number): TickResult {
  const mode = modeFor(state, nowMs);
  const head = nextUp(state.queue, mode);
  if (!head) {
    return { state, mode, release: null, nextTickMs: SCHEDULE.minGapMs };
  }

  const gap = gapFor(state.queue, mode, head, state.lastWeight, nowMs);
  const waited = nowMs - state.lastReleaseAt;
  if (waited < gap) {
    return { state, mode, release: null, nextTickMs: gap - waited };
  }

  const group = collapseWith(head, state.queue);
  const mergedIds = group.map((r) => r.id);
  const taken = new Set(mergedIds);
  const seen = [...state.seen, ...mergedIds].slice(-SCHEDULE.memory);

  const next: ScheduleState = {
    queue: state.queue.filter((r) => !taken.has(r.id)),
    lastReleaseAt: nowMs,
    lastWeight: clampWeight(head.weight),
    lastActivityAt: isReal(head) ? nowMs : state.lastActivityAt,
    seen,
  };

  return {
    state: next,
    mode,
    release: { ...head, mergedIds, mergedCount: mergedIds.length },
    // Look ahead with the mode AND the pressure the drained queue implies —
    // recomputing without the pressure term is what let acceleration undo
    // itself the moment it was needed.
    nextTickMs: (() => {
      const after = modeFor(next, nowMs);
      const upcoming = nextUp(next.queue, after);
      return upcoming
        ? gapFor(next.queue, after, upcoming, next.lastWeight, nowMs)
        : SCHEDULE.minGapMs;
    })(),
  };
}
