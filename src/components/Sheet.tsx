/**
 * SEE ALL — the one full-height sheet, for every list too long for its rail.
 *
 * IT WAS ALREADY THE ANSWER; IT JUST HAD ONE OWNER. `CaseFile` grew this to hold a
 * believer roster that would not fit beside a market, and every decision in it was
 * made for the general case rather than for believers: portal to the body, own
 * scroll area, pinned header, Escape to close. The Challenge history needed exactly
 * the same thing, and the alternative was a second implementation that would drift
 * — a different close key, a different scrim, a sheet that traps itself inside a
 * column on one surface and not the other.
 *
 * So it moved here and `CaseFile` renders it. Nothing about the believer roster
 * changed; it is the same element with the title passed in.
 *
 * WHY IT IS PORTALLED, AND IT IS NOT DECORATION. An ancestor rail can create a
 * containing block (a `transform`, a `contain`), and a `fixed` child of one is
 * positioned against that ancestor rather than the viewport — which traps a
 * "full width" sheet inside one column. Rendering into `document.body` is what
 * makes the promise in the CSS true.
 */
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function Sheet({
  title,
  onClose,
  children,
}: {
  /** The pinned header line. A node, because callers count things differently. */
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed inset-x-0 bottom-0 top-0 z-[80] flex flex-col"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      {/* Fills the column top to bottom: a pinned header over one scroll area, so
        the list never resizes the sheet as it loads. */}
      <div className="relative mt-auto flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-t-[16px] border-t border-[var(--border)] bg-[var(--bg)] pt-3">
        <div className="mx-auto mb-2 flex w-full max-w-[720px] shrink-0 items-center justify-between px-4">
          <span className="text-[12px] font-semibold text-[var(--text)]">{title}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 rounded-full px-2 py-1 text-[14px] text-[var(--text-muted)] hover:text-[var(--text)]"
          >
            ×
          </button>
        </div>
        <div className="mx-auto min-h-0 w-full max-w-[720px] flex-1 overflow-y-auto px-4 pb-[max(16px,env(safe-area-inset-bottom))]">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
