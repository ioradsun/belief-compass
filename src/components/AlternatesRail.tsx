/**
 * OTHER WAYS TO ASK — the right rail's rewrites of the question being written.
 *
 * This is where the form's old inline "Polish" went, and why the form no longer
 * jumps. A single rewrite appearing under the textarea a beat after the writer
 * paused was two mistakes at once: the AI's opinion arrived as a layout shift,
 * and one edit is not a choice. Here it is neither — the rail sits beside the
 * form, so nothing it does can move a field, and it offers 2–3 genuinely
 * different angles the writer adopts with a tap.
 *
 * IT READS THE SAME PROBE THE NEIGHBOUR SEARCH DOES. The form publishes a
 * debounced probe (create-draft#setProbe); this subscribes to it, so the rewrite
 * request lives next to the feed without the form owning the UI — exactly the
 * split SimilarMarkets already uses on the left. Adopting writes back through
 * `adoptQuestion`, which the mounted form applies in place.
 *
 * SILENCE IS HONEST. No probe, too short a draft, or nothing distinct to offer →
 * the panel renders nothing at all, the same way IdeasRail self-hides with no
 * spark. A rail padded to look busy just teaches a reader to ignore the column.
 */
import { useQuery } from "@tanstack/react-query";
import { adoptQuestion, useSuggestionProbe } from "@/lib/create-draft";
import { suggestAlternateQuestions } from "@/lib/market-create.functions";

/** Below this the draft is not yet a question worth rewriting. */
const MIN_FOR_ALTERNATES = 12;

export function AlternatesRail() {
  const probe = useSuggestionProbe();
  const q = probe?.question?.trim() ?? "";
  const enabled = q.length >= MIN_FOR_ALTERNATES;

  const { data, isFetching } = useQuery({
    queryKey: ["question-alternates", q],
    queryFn: () => suggestAlternateQuestions({ data: { question: q } }),
    enabled,
    // A rewrite of one wording does not change; hold it so re-pausing on the
    // same text costs nothing.
    staleTime: 5 * 60_000,
  });

  // The server already de-duplicates against the exact `q` it was handed; this
  // only guards the case where the field moved on to equal an alternate.
  const alternates = (data?.alternates ?? [])
    .map((a) => a.trim())
    .filter((a) => a.length > 0 && a.toLowerCase() !== q.toLowerCase())
    .slice(0, 3);

  // EVERY STAGE IS NARRATED. The heading is permanent so the writer learns the
  // column exists before it has anything to say, and the line beneath it says
  // exactly which stage we are in: waiting on words, thinking, or empty-handed.
  if (!enabled) {
    return (
      <div>
        <RailHeading />
        <p className="text-[11.5px] leading-snug text-[var(--text-muted)]">
          Write your question and we&apos;ll offer sharper ways to ask it.
        </p>
      </div>
    );
  }
  if (alternates.length === 0) {
    return (
      <div>
        <RailHeading />
        <p className="text-[11.5px] leading-snug text-[var(--text-muted)]">
          {isFetching ? "Finding other angles…" : "Your wording is already the sharpest we have."}
        </p>
      </div>
    );
  }


  return (
    <div>
      <RailHeading />
      <div className="space-y-2">
        {alternates.map((alt) => (
          <button
            key={alt}
            type="button"
            onClick={() => adoptQuestion(alt)}
            className="block w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left text-[13px] leading-snug text-[var(--text)] transition-colors hover:border-[var(--border-strong)]"
          >
            {alt}
          </button>
        ))}
      </div>
      {/* No dismiss control: unlike the House spark, these are about the reader's
          own words and cost nothing to ignore — they simply vanish when the
          question does. */}
    </div>
  );
}

function RailHeading() {
  return (
    <div className="mb-3 text-[11px] font-semibold tracking-wide text-[var(--text-muted)] uppercase">
      Other ways to ask
    </div>
  );
}
