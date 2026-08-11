/**
 * NEED A SPARK? — the right rail while a market is being written.
 *
 * THE RAILS CHANGE JOBS AS THE STORY MOVES, and that transition is the whole
 * design. While somebody is composing:
 *
 *   LEFT    Already out there?   — SimilarMarkets, so nobody rebuilds a live debate
 *   CENTRE  What do you believe? — the question, the side, the amount
 *   RIGHT   Need a spark?        — this
 *
 * The instant the market publishes, the right rail becomes `LaunchRail`: "Your
 * market is live. 8 Tribe · 2 Rivals." Left protects against duplication, right
 * stimulates creation, centre is the act — and asking "who should participate?"
 * before the market exists is premature, which is why recruitment lives strictly
 * after publish and never in the form.
 *
 * ONE IDEA, NOT A FEED. `useHouseIdea` produces a single ready suggestion at a
 * time, and this renders exactly that. No filler, no "ideas you might like"
 * carousel assembled to make the column look busy: with nothing to suggest the
 * panel renders nothing at all, the same way SimilarMarkets self-hides when
 * nothing is genuinely similar. An empty rail is honest; a padded one teaches a
 * reader to ignore the column.
 *
 * IT WILL NOT OVERWRITE WHAT SOMEBODY IS TYPING. Accepting a suggestion calls
 * `startDraftFromSuggestion`, which replaces the draft wholesale — fine from an
 * empty form, destructive halfway through a sentence somebody is still choosing.
 * So the action appears only while the question is empty. Once there are words in
 * the field the same idea stays on screen as pure inspiration, with nothing to
 * click. Nobody loses a thought to a mis-tap.
 */
import { getDraft } from "@/lib/create-draft";
import type { ReadySuggestion } from "@/lib/market-suggestion.server";

export function IdeasRail({
  suggestion,
  onUse,
  onDismiss,
}: {
  /** The one ready suggestion, or null — in which case nothing renders. */
  suggestion: ReadySuggestion | null;
  onUse: () => void;
  onDismiss: () => void;
}) {
  if (!suggestion) return null;
  // Read at render rather than held in state: the draft is written by the form
  // next door, and a stale copy here would offer to overwrite a question that
  // now exists. Cheap — this is a localStorage read behind a mounted panel.
  const writing = getDraft().question.trim().length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 shrink-0 text-[11px] font-semibold tracking-wide text-[var(--text-muted)] uppercase">
        Market Ideas
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
        <p className="text-[13px] leading-snug text-[var(--text)]">{suggestion.question}</p>
        {/* WHY THIS ONE, in the suggester's own words. `fitLine` says what about
            this reader made it worth suggesting; `shortReason` says why the
            question is worth asking at all. The fit is the more interesting of
            the two here, because the reader is already choosing what to ask. */}
        {(suggestion.fitLine || suggestion.shortReason).trim() && (
          <p className="mt-1.5 text-[11.5px] leading-snug text-[var(--text-secondary)]">
            {(suggestion.fitLine || suggestion.shortReason).trim()}
          </p>
        )}

        {writing ? (
          /* WORDS ALREADY IN THE FIELD. The idea stays visible — it may still be
             the better question — but there is nothing to press, because pressing
             it would replace a sentence somebody is mid-way through writing. */
          <p className="mt-2 text-[11px] text-[var(--text-muted)]">
            Keep your own question — this one is just here for the angle.
          </p>
        ) : (
          <button
            type="button"
            onClick={onUse}
            className="mt-2.5 w-full rounded-lg border border-[var(--border)] px-2 py-1.5 text-[12px] font-medium text-[var(--text)] transition-colors hover:border-[var(--border-strong)]"
          >
            Ask this instead
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={onDismiss}
        className="mt-2 self-start text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
      >
        Not this one
      </button>
    </div>
  );
}
