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
  /** Which side the row is about, when it is about one. */
  side?: "YES" | "NO" | null;
  /**
   * True when the row is a DERIVED reading of market state (a capital/price
   * move) rather than a named thing a person did. Derived rows are the ones
   * that can restate somebody else's story.
   */
  derived?: boolean | null;
  /** What the derived row measured. */
  metric?: "capital" | "price" | "believers" | null;
  /**
   * Whether the reader has enough context to understand the row on its own —
   * chiefly, whether we know WHICH QUESTION it is about. `undefined` means the
   * caller is not asserting either way; only an explicit `false` drops the row.
   */
  context?: boolean | null;
  /**
   * True when the row is a ROLLING-WINDOW reading — a statement about the last
   * hour/day rather than about a moment. Two of these on one market are two
   * observations of overlapping windows, not two developments.
   */
  rolling?: boolean | null;
  /** Event family, for capping how much of the feed one family may occupy. */
  family?: string | null;
  /**
   * The copy layer already decided this row should not be printed — chiefly a
   * percentage it could not size, or a percentage over pocket change. See
   * `retellTransition`. Editorial honours that verdict rather than re-deriving
   * it, because only the copy layer knows what sentence would have shipped.
   */
  suppressed?: boolean | null;
  /**
   * Does the row carry a SECOND FACT — something beyond the bare structural
   * announcement? "NO just got company" is an event type. "NO was empty, three
   * wallets stepped in within the hour" is intelligence. First-participation
   * rows without a second fact are ordinary, and ordinary is allowed at most
   * one slot.
   */
  secondFact?: boolean | null;
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
  /**
   * A conviction count only becomes news for STRANGERS at real scale. 5 is a
   * fact about somebody the reader has never met; 25 is a standing. Below the
   * bar the row still ships when the person is personally relevant.
   */
  minMilestoneRung: 25,
  /**
   * How close a derived market move has to be to a named trade on the same side
   * before it counts as a restatement of it. Six hours is the window in which a
   * reader would still connect the two as one development.
   */
  causalWindowMs: 6 * 3_600_000,
  /**
   * How many rows one family may occupy in a single feed. Resurrection is
   * CLOCK-driven — every dormant market crosses the bar in the same sweep — so
   * without a cap a quiet day fills the feed with "back from the dead" and the
   * feed looks padded rather than alive.
   */
  familyCaps: { market_reawakened: 2 } as Record<string, number>,
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
  // A row a reader cannot place — no question, no market — is a fact without a
  // subject. "NEW BELIEVER · Someone backed YES" of WHAT?
  if (r.context === false) return false;
  if (r.action === "exit" && r.amountUsd != null && num(r.amountUsd) < EDITORIAL.minExitUsd)
    return false;
  if (r.kind === "person_milestone" && (r.rung ?? 0) < EDITORIAL.minMilestoneRung && !r.personal)
    return false;
  return true;
}

/**
 * ONE FAMILY MAY NOT OWN THE FEED. Keeps the first N rows of a capped family in
 * the caller's order (which is already strongest-first) and drops the rest.
 */
export function capFamilies<T extends EditorialRow>(rows: readonly T[]): T[] {
  const seen = new Map<string, number>();
  return rows.filter((r) => {
    const cap = r.family ? EDITORIAL.familyCaps[r.family] : undefined;
    if (cap == null) return true;
    const n = (seen.get(r.family!) ?? 0) + 1;
    seen.set(r.family!, n);
    return n <= cap;
  });
}

/**
 * A DERIVED MOVE THAT SOMEBODY ELSE'S STORY ALREADY EXPLAINS IS NOT NEWS.
 *
 * "BELIEVER LEFT NO — Alex left with $15" and "Capital on NO fell 83%" are one
 * event measured twice: the second is the arithmetic consequence of the first.
 * The named telling is strictly better (it has a person, an amount and a
 * reason), so when both are in hand for the same market and side inside the
 * causal window, the derived reading yields.
 */
export function collapseCausal<T extends EditorialRow>(rows: readonly T[]): T[] {
  const causal = rows.filter((r) => !r.derived);
  if (causal.length === 0) return [...rows];
  const at = (r: EditorialRow) => Date.parse(r.occurredAt) || 0;
  return rows.filter((r) => {
    if (!r.derived) return true;
    return !causal.some(
      (c) =>
        c.marketId === r.marketId &&
        (r.side == null || c.side == null || c.side === r.side) &&
        Math.abs(at(c) - at(r)) <= EDITORIAL.causalWindowMs,
    );
  });
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
    /* ROLLING WINDOWS NEVER REPEAT. "3 joined / $215 left" at 50m and
       "9 joined / $85 left" at 1h are the same rolling state read twice over
       overlapping windows; printing both invites a reader to count one
       development as two. The newest reading REPLACES the older one, and only a
       change of category (a different motif) earns a second row. Moment events
       — a trade, an exit — keep the escalation exemption, because a bigger
       second one genuinely did happen. */
    if (!r.rolling && !kept.some((k) => k.rolling) && kept.every((k) => escalated(k, r)))
      kept.push(r);
    else dropped.add(r.id);
  }
  return rows.filter((r) => !dropped.has(r.id));
}

/** Both rules, in the order an editor applies them. */
export function editFeed<T extends EditorialRow>(rows: readonly T[]): T[] {
  return capFamilies(pruneRepeats(collapseCausal(rows.filter(earnsSlot))));
}
