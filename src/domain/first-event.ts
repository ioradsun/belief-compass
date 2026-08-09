/**
 * FIRST-EVENT TAXONOMY — three transitions that are dangerously close.
 *
 * "YES has its first believers", "Nobody had backed NO. Then 2 people did." and
 * "First capital backs NO" were all reachable off the same trade, so a reader
 * could see one development described twice in two grammars. The taxonomy is
 * now explicit and MUTUALLY EXCLUSIVE — exactly one of these can be true of a
 * single transition:
 *
 *   went_first   — the side went 0 → populated and exactly ONE identifiable
 *                  person did it. A person story.
 *   side_opened  — the side went 0 → populated but SEVERAL people arrived at
 *                  once. That is an empty-side → populated-side event, not
 *                  somebody's act of going first.
 *   first_capital— the side already HAD believers and no money, and now has
 *                  money. Only meaningful when the room was already occupied;
 *                  otherwise it is the same transition as the two above.
 *
 * ZERO IO, pure, fully testable.
 */

export type FirstEventKind = "went_first" | "side_opened" | "first_capital";

export interface FirstEventInput {
  /** Believers on this side BEFORE the move. */
  believersBefore: number;
  /** Believers on this side AFTER the move. */
  believersAfter: number;
  /** Distinct people in this move. */
  peopleCount?: number | null;
  /** Committed capital on this side before / after, in USD. */
  capitalBeforeUsd?: number | null;
  capitalAfterUsd?: number | null;
}

/** Below this, "capital" is a rounding artefact rather than money on the table. */
export const FIRST_CAPITAL_DUST_USD = 0.01;

const num = (v: number | null | undefined): number =>
  v == null || !Number.isFinite(Number(v)) ? 0 : Number(v);

/**
 * Which first-event — if any — this transition IS. Never more than one, so no
 * two composers can describe the same change.
 */
export function classifyFirstEvent(input: FirstEventInput): FirstEventKind | null {
  const before = num(input.believersBefore);
  const after = num(input.believersAfter);

  if (before <= 0 && after > 0) {
    const people = Math.max(1, num(input.peopleCount) || Math.max(1, after));
    return people === 1 && after === 1 ? "went_first" : "side_opened";
  }

  // The room was already occupied: money arriving is its own, separate first.
  if (before > 0) {
    const capBefore = num(input.capitalBeforeUsd);
    const capAfter = num(input.capitalAfterUsd);
    if (capBefore <= FIRST_CAPITAL_DUST_USD && capAfter > FIRST_CAPITAL_DUST_USD)
      return "first_capital";
  }

  return null;
}
