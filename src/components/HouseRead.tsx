/**
 * THE HOUSE READ — one row, one component, every screen size.
 *
 * The House's running attempt to call your next move, rendered as a single
 * integrated row of the market summary card (never its own card or modal). The
 * SAME component and the SAME state serve desktop and mobile — there is no
 * mobile variant, no icon-only fallback, and nothing is hidden at a breakpoint.
 *
 * On a narrow screen the sentence WRAPS onto a second line rather than
 * truncating: the message is the feature, so it is never clipped to save space.
 *
 * Presentation only — every word comes from the pure src/domain/house-read
 * engine, so the copy and the state machine can't drift between surfaces.
 */
import { houseReadCopy, type HouseReadState } from "@/domain/house-read";

export function HouseRead({
  state,
  className = "",
}: {
  state: HouseReadState;
  className?: string;
}) {
  const copy = houseReadCopy(state);
  const sideColor = copy.side === "YES" ? "var(--yes)" : "var(--no)";
  // A settled round tints only the verdict, so a win/loss reads instantly
  // without turning the row into a banner.
  const bodyColor =
    copy.tone === "correct"
      ? "var(--yes)"
      : copy.tone === "incorrect"
        ? "var(--no)"
        : "var(--text-secondary)";

  return (
    <div
      className={`flex min-w-0 items-start gap-2 text-[12px] leading-snug ${className}`}
      // The whole row is one sentence for a screen reader, side included.
      aria-label={`The House Read. ${copy.body}${copy.side ?? ""}${copy.suffix}`}
    >
      <span aria-hidden className="shrink-0 leading-snug">
        🏠
      </span>
      {/* min-w-0 + normal wrapping: the sentence flows to a second line on a
          phone instead of being cut off. */}
      <p className="m-0 min-w-0 flex-1 break-words">
        {copy.label && <span className="font-semibold text-[var(--text)]">{copy.label} </span>}
        <span style={{ color: bodyColor }}>{copy.body}</span>
        {copy.side && (
          <span className="font-semibold" style={{ color: sideColor }}>
            {copy.side}
          </span>
        )}
        {copy.suffix && <span className="text-[var(--text-muted)]">{copy.suffix}</span>}
      </p>
    </div>
  );
}
