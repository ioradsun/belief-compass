/**
 * FEED EDITORIAL — the subtraction pass.
 *
 * Everything upstream decides what is TRUE and how BIG it is. This decides what
 * is worth a human's attention, and it works by removing rows, never by adding
 * or rewriting them. Two rules, both of them things a good editor would say out
 * loud:
 *
 *   1. A SECOND ROW ABOUT THE SAME MARKET MUST SAY SOMETHING THE FIRST DIDN'T.
 *      "Money is leaving YES" three times on one question is one fact printed
 *      three times. Same market + same motif collapses to the newest telling,
 *      unless the magnitude moved materially — in which case the story really
 *      did progress and the second row has earned its slot.
 *
 *   2. LOW-VALUE TRUTH IS STILL NOT NEWS. A penny exit is technically an event
 *      and costs a reader the same attention as a real one. So does a third
 *      conviction from somebody they have never met. Both are dropped.
 *
 * ZERO IO, pure, deterministic, fully testable.
 */

export interface EditorialRow {
  id: string;
  kind: string;
  marketId: string;
  /** ISO. Newest wins inside a repeat group. */
  occurredAt: string;
  /** Semantic identity of the story being told. No motif → never a repeat. */
  motif?: string | null;
  amountUsd?: number | null;
  significance?: number | null;
  /** What the actor did to their belief, when the row is a trade. */
  action?: string | null;
  /** True when the row is about somebody the reader is connected to. */
  personal?: boolean | null;
  /** The rung a person-milestone row crossed. */
  rung?: number | null;
}

export const EDITORIAL = {
  /**
   * Below this, an exit is a rounding error. Reporting "AMIR left with $0.01"
   * spends a reader's attention on a penny.
   */
  minExitUsd: 1,
  /**
   * How much the same story must have moved to earn a second row. 1.5× is the
   * smallest change a reader would describe as "it got worse".
   */
  escalation: 1.5,
  /**
   * The first conviction count worth telling a stranger about. Three matters
   * structurally — it is where relationships can start forming — but it is not
   * automatically interesting to anyone else, so it needs the reader to already
   * know the person.
   */
  minMilestoneRung: 5,
} as const;

const num = (v: number | null | undefined): number =>
  v == null || !Number.isFinite(Number(v)) ? 0 : Math.abs(Number(v));

/** How big this telling is, for comparing two versions of the same story. */
function magnitude(r: EditorialRow): number {
  const amt = num(r.amountUsd);
  return amt > 0 ? amt : num(r.significance);
}

/**
 * Would this make one person say "wait, what happened?" to another? If not, it
 * should not take a slot.
 */
export function earnsSlot(r: EditorialRow): boolean {
  if (r.action === "exit" && r.amountUsd != null && num(r.amountUsd) < EDITORIAL.minExitUsd)
    return false;
  if (r.kind === "person_milestone" && (r.rung ?? 0) < EDITORIAL.minMilestoneRung && !r.personal)
    return false;
  return true;
}

/** Materially different tellings of the same story, in either direction. */
function escalated(kept: EditorialRow, next: EditorialRow): boolean {
  const a = magnitude(kept);
  const b = magnitude(next);
  if (a <= 0 || b <= 0) return false;
  const hi = Math.max(a, b);
  const lo = Math.min(a, b);
  return hi / lo >= EDITORIAL.escalation;
}

/**
 * Collapse repeated snapshots of one fact. Rows keep their input order; only
 * the redundant repeats are removed, so the caller's ordering (and any pinning
 * above it) survives untouched.
 */
export function pruneRepeats<T extends EditorialRow>(rows: readonly T[]): T[] {
  // Newest first inside each group, so the surviving telling is the latest one.
  const order = [...rows].sort((a, b) =>
    a.occurredAt < b.occurredAt ? 1 : a.occurredAt > b.occurredAt ? -1 : 0,
  );
  const keptByGroup = new Map<string, T[]>();
  const dropped = new Set<string>();
  for (const r of order) {
    if (!r.motif) continue;
    const key = `${r.marketId}|${r.motif}`;
    const kept = keptByGroup.get(key);
    if (!kept) {
      keptByGroup.set(key, [r]);
      continue;
    }
    if (kept.every((k) => escalated(k, r))) kept.push(r);
    else dropped.add(r.id);
  }
  return rows.filter((r) => !dropped.has(r.id));
}

/** Both rules, in the order an editor applies them. */
export function editFeed<T extends EditorialRow>(rows: readonly T[]): T[] {
  return pruneRepeats(rows.filter(earnsSlot));
}
