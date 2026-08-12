/**
 * THE INSIDER READ — one row, one component, every screen size.
 *
 * The Insider's running attempt to call your next move, rendered as a single
 * integrated row of the market summary card (never its own card or modal). The
 * SAME component and the SAME state serve desktop and mobile — there is no
 * mobile variant, no icon-only fallback, and nothing is hidden at a breakpoint.
 *
 * On a narrow screen the sentence WRAPS onto a second line rather than
 * truncating: the message is the feature, so it is never clipped to save space.
 *
 * Presentation only — every word comes from the pure Insider read projection
 * (`domain/insider/projections/read`), so the copy and the state machine can't
 * drift between surfaces.
 */
import { insiderReadCopy } from "@/domain/insider";
import type { InsiderRead as InsiderReadState } from "@/domain/insider";

export function InsiderRead({
  read,
  className = "",
}: {
  read: InsiderReadState;
  className?: string;
}) {
  const copy = insiderReadCopy(read);
  const sideColor = copy.side === "YES" ? "var(--yes)" : "var(--no)";
  // A settled round states the verdict plainly. It deliberately does NOT borrow
  // the gain/loss palette: green and red mean money on every other surface, and
  // "the House called it" is not a profit.
  const bodyColor =
    copy.tone === "neutral" ? "var(--text-secondary)" : "var(--text)";


  return (
    <div
      className={`flex min-w-0 items-start text-[12px] leading-snug ${className}`}
      // The whole row is one sentence for a screen reader, side and context included.
      aria-label={`Insider Read. ${copy.body}${copy.side ?? ""}${copy.suffix}${
        copy.context ? ` ${copy.context}` : ""
      }`}
    >
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
        {/* Market context reads as an aside, never as part of the call. */}
        {copy.context && (
          <span className="text-[var(--text-muted)]"> {copy.context}</span>
        )}
      </p>
    </div>
  );
}
