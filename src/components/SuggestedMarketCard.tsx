/**
 * "The House has an idea" — one feed card.
 *
 * Deliberately the SAME object as a market: same eyebrow, same headline scale,
 * same byline rhythm, same dock geometry. Only the two dock buttons change —
 * CREATE and PASS stand exactly where YES and NO stand — so accepting an idea
 * never feels like leaving the feed for an advertisement.
 *
 * It states fit and novelty. It never states demand, earnings, or urgency.
 */
import { rewardLine } from "@/domain/market-suggestion";
import type { ReadySuggestion } from "@/lib/market-suggestion.functions";

export function SuggestedMarketCard({
  suggestion,
  creatorFeeBps,
  onCreate,
  onEdit,
  onDismiss,
}: {
  suggestion: ReadySuggestion;
  creatorFeeBps: number | null;
  onCreate: () => void;
  onEdit: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3" aria-label="The House has an idea">
      {/* Identity — the deck's own header rhythm. */}
      <div className="shrink-0">
        <div className="mb-1 flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
            {suggestion.category}
          </span>
          <span
            className="ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text)]"
            style={{ border: "1px solid var(--border-strong,var(--border))" }}
          >
            <span aria-hidden>🏠</span> The House has an idea
          </span>
        </div>

        <h1 className="text-[clamp(20px,2.4vw,30px)] font-semibold leading-tight tracking-tight text-[var(--text)]">
          {suggestion.question}
        </h1>
        <p className="mt-1.5 text-[13px] leading-snug text-[var(--text-secondary)]">
          This feels like your kind of question.
        </p>
      </div>

      <div className="flex min-h-0 flex-1 touch-pan-y flex-col gap-3 overflow-y-auto overscroll-contain pr-0.5">
        <div className="border-t border-[var(--border)]" aria-hidden />

        <p className="text-[14px] leading-relaxed text-[var(--text-secondary)]">
          {suggestion.fitLine}
        </p>

        {suggestion.shortReason && (
          <p className="text-[13px] leading-relaxed text-[var(--text-muted)]">
            {suggestion.shortReason}
          </p>
        )}

        {suggestion.topics.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {suggestion.topics.slice(0, 5).map((t) => (
              <span
                key={t}
                className="rounded-full px-2.5 py-1 text-[11px] font-medium text-[var(--text-muted)]"
                style={{ border: "1px solid var(--border)" }}
              >
                {t}
              </span>
            ))}
          </div>
        )}

        <div className="border-t border-[var(--border)]" aria-hidden />

        <p className="text-[13px] leading-relaxed text-[var(--text-secondary)]">
          {rewardLine(creatorFeeBps)}
        </p>

        <button
          type="button"
          onClick={onEdit}
          className="self-start text-[13px] text-[var(--text-muted)] underline-offset-4 transition-colors hover:text-[var(--text)] hover:underline"
        >
          Edit idea
        </button>
      </div>

      {/* Decision dock — CREATE and PASS sit exactly where YES and NO sit. */}
      <div className="shrink-0">
        <div
          className="flex items-center gap-2 rounded-[16px] p-3"
          style={{ border: "1px solid var(--border)" }}
        >
          <div className="flex flex-1 gap-2">
            <button
              type="button"
              onClick={onDismiss}
              className="h-[52px] flex-1 rounded-[12px] text-[14px] font-semibold transition-colors"
              style={{ border: "1px solid var(--border)", color: "var(--text-secondary)" }}
            >
              ↑ Not for me
            </button>
            <button
              type="button"
              onClick={onCreate}
              className="h-[52px] flex-[1.4] rounded-[12px] text-[14px] font-semibold transition-colors"
              style={{ background: "var(--text)", color: "var(--bg)" }}
            >
              Create this market →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
