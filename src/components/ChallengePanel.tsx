/**
 * CHALLENGE, INSIDE THE MARKET COLUMN — not a page, not a viewport-wide sheet.
 *
 * The reader pressed a control at the bottom of a market they can still see.
 * This slides out over EXACTLY the container that control belongs to: the
 * center column, full height, its own width. A body-portalled bottom sheet was
 * wrong here — it covered rails the reader never left and made the action feel
 * global when it belongs to one market.
 *
 * HOW IT FINDS ITS CONTAINER. An invisible anchor is rendered in place and asks
 * for the nearest `[data-panel-surface]` ancestor, then the panel is portalled
 * into it. That keeps the panel's geometry tied to the column even though the
 * button that opened it lives several levels deep inside the order dock (whose
 * own `overflow-hidden` would otherwise clip it).
 *
 * IT SENDS TO THE WHOLE AUDIENCE, and says so. `put_on_table` puts the question
 * up for everyone who qualifies in one transaction, so the send button covers
 * the order bar region and commits the lot.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AudienceGroups } from "@/components/AudiencePreview";
import type { AudienceGroupView } from "@/domain/audience";
import { RELAY_COST } from "@/domain/chain";

/**
 * EARN THE WORD. "Tribe" is a reward, not vocabulary a first-timer must learn,
 * so the rows describe what is checkably true until the concept has been felt.
 */
const plain = (label: string): string =>
  label === "Your Tribe" || label === "Your Twin + Tribe"
    ? "People who think like you"
    : label === "Your Rivals"
      ? "People who usually disagree"
      : label;

export function ChallengePanel({
  count,
  groups,
  remaining,
  pending,
  onSend,
  onClose,
}: {
  count: number;
  groups?: AudienceGroupView[];
  remaining: number;
  pending: boolean;
  onSend: () => void;
  onClose: () => void;
}) {
  const anchor = useRef<HTMLSpanElement | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = anchor.current?.closest("[data-panel-surface]");
    setHost((el as HTMLElement | null) ?? null);
  }, []);

  // One frame after mount so the transition has a start state to move from.
  useEffect(() => {
    if (!host) return;
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [host]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const panel = host
    ? createPortal(
        <div className="absolute inset-0 z-[60] overflow-hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${
              shown ? "opacity-100" : "opacity-0"
            }`}
          />
          <div
            className={`absolute inset-0 flex flex-col rounded-[16px] border border-[var(--border)] bg-[var(--bg)] shadow-2xl transition-transform duration-200 ease-out ${
              shown ? "translate-y-0" : "translate-y-3"
            }`}
            style={{ opacity: shown ? 1 : 0, transitionProperty: "transform, opacity" }}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-3">
              <span className="text-[12px] font-semibold text-[var(--text)]">Ask your people</span>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-1 rounded-full px-2 py-1 text-[14px] text-[var(--text-muted)] hover:text-[var(--text)]"
              >
                ×
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <p className="text-[13px] leading-snug text-[var(--text-secondary)]">
                {count === 1
                  ? "One person gets this question next. See if they call it the same way."
                  : `${count} people get this question next. See who calls it the same way.`}
              </p>
              {groups && groups.length > 0 && (
              <div className="mt-3 border-t border-[var(--border)] pt-3">
                <AudienceGroups
                  groups={groups.map((g) => ({ ...g, label: plain(g.label) }))}
                  stacked
                />
              </div>
              )}
            </div>

            {/* The send control sits exactly where the order bar was — the same
              region of the column, now committing this action instead. */}
            <div className="shrink-0 border-t border-[var(--border)] px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
              <button
                type="button"
                disabled={pending}
                onClick={onSend}
                className="w-full rounded-[12px] bg-[var(--text)] px-3 py-2.5 text-[13px] font-semibold text-[var(--bg)] transition-opacity disabled:opacity-50"
              >
                {pending ? "Sending…" : count === 1 ? "Send it" : `Send to all ${count}`}
              </button>
              <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
                {RELAY_COST} · {remaining} of 3 slots free
              </p>
            </div>
          </div>
        </div>,
        host,
      )
    : null;

  return (
    <>
      <span ref={anchor} className="hidden" aria-hidden="true" />
      {panel}
    </>
  );
}
