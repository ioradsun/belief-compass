/**
 * THE INSIDER READ — one row, one component, every screen size.
 *
 * PREDICT FIRST, PROVE IT AFTER. Before the choice this is a label and one
 * sentence — no evidence, no market context. After the choice it states the
 * verdict and shows the single locked reason it was given.
 *
 * The SAME component and the SAME state serve desktop and mobile — no mobile
 * variant, nothing hidden at a breakpoint. On a narrow screen the sentence WRAPS
 * rather than truncating: the message is the feature.
 *
 * Presentation only — every word comes from the pure Insider read projection
 * (`domain/insider/projections/read`), and nothing is calculated here.
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
  // the gain/loss palette: green and red mean money on every other surface.
  const bodyColor =
    copy.tone === "neutral" ? "var(--text-secondary)" : "var(--text)";

  return (
    <div
      className={`flex min-w-0 flex-col gap-0.5 text-[12px] leading-snug ${className}`}
      // The whole row is one sentence for a screen reader.
      aria-label={`Insider Read. ${copy.body}${copy.side ?? ""}${
        copy.reason ? ` ${copy.reason}` : ""
      }`}
    >
      <p className="m-0 min-w-0 break-words">
        {copy.label && <span className="font-semibold text-[var(--text)]">{copy.label} </span>}
        <span style={{ color: bodyColor }}>{copy.body}</span>
        {copy.side && (
          <span className="font-semibold" style={{ color: sideColor }}>
            {copy.side}
          </span>
        )}
      </p>
      {/* The one locked reason. Only ever present after the choice. */}
      {copy.reason && (
        <p className="m-0 min-w-0 break-words text-[var(--text-muted)]">{copy.reason}</p>
      )}
    </div>
  );
}
