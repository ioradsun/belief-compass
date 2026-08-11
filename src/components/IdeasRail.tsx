/**
 * MARKET IDEAS — the left rail while a market is being written.
 *
 * THE COLUMN ALWAYS SPEAKS. It used to render nothing whenever the House had no
 * personalised spark, which is exactly the writer who needed it most: a first
 * timer with an empty form and an empty column beside it. Silence is only
 * honest when the reader knows why it is silent. So the heading is permanent,
 * and under it the rail says what it can do and how to make it do it.
 *
 * A TOPIC IS THE SMALLEST HONEST INPUT. We cannot suggest a good question from
 * nothing, and we will not pad the column with filler. One tap on a topic buys
 * four questions people genuinely disagree about — the model is told to aim at
 * the disagreement, never at a fact that can be looked up.
 *
 * IT WILL NOT OVERWRITE A SENTENCE IN PROGRESS. The House spark replaces the
 * draft wholesale (`startDraftFromSuggestion`), so its button only appears from
 * an empty field. Topic ideas go through `adoptQuestion`, which swaps only the
 * question text in place — safe at any point, so those stay tappable.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adoptQuestion, getDraft } from "@/lib/create-draft";
import { suggestTopicIdeas } from "@/lib/market-create.functions";
import type { ReadySuggestion } from "@/lib/market-suggestion.server";

/**
 * The topics people argue hardest about. Deliberately weighted to belief rather
 * than news: a market about human nature is still contested next month, a
 * market about this week's headline is dead by then.
 */
const TOPICS = [
  "Human nature",
  "Religion & meaning",
  "Self-help",
  "Relationships",
  "Money",
  "AI",
  "Society",
  "Morality",
] as const;

export function IdeasRail({
  suggestion,
  onUse,
  onDismiss,
}: {
  /** The one personalised House suggestion, or null. */
  suggestion: ReadySuggestion | null;
  onUse: () => void;
  onDismiss: () => void;
}) {
  const [topic, setTopic] = useState<string | null>(null);

  // Read at render rather than held in state: the draft is written by the form
  // next door, and a stale copy here would offer to overwrite a question that
  // now exists.
  const writing = getDraft().question.trim().length > 0;

  const { data, isFetching, isError } = useQuery({
    queryKey: ["topic-ideas", topic],
    queryFn: () => suggestTopicIdeas({ data: { topic: topic! } }),
    enabled: !!topic,
    // Same topic, same four ideas for the session — re-tapping costs nothing.
    staleTime: 10 * 60_000,
  });
  const ideas = data?.ideas ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-1.5 shrink-0 text-[11px] font-semibold tracking-wide text-[var(--text-muted)] uppercase">
        Market ideas
      </div>


      {/* THE PERSONALISED SPARK, when there is one, sits above the topics — it
          knows something about this reader that a topic never will. */}
      {suggestion && (
        <div className="mb-3 shrink-0 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
          <p className="text-[13px] leading-snug text-[var(--text)]">{suggestion.question}</p>
          {(suggestion.fitLine || suggestion.shortReason).trim() && (
            <p className="mt-1.5 text-[11.5px] leading-snug text-[var(--text-secondary)]">
              {(suggestion.fitLine || suggestion.shortReason).trim()}
            </p>
          )}

          {writing ? (
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

          <button
            type="button"
            onClick={onDismiss}
            className="mt-2 text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
          >
            Not this one
          </button>
        </div>
      )}

      <div className="mb-3 flex shrink-0 flex-wrap gap-1.5">
        {TOPICS.map((t) => {
          const on = topic === t;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTopic(t)}
              className="rounded-full border px-2.5 py-1 text-[11.5px] transition-colors"
              style={{
                borderColor: on ? "var(--border-strong)" : "var(--border)",
                color: on ? "var(--text)" : "var(--text-secondary)",
                background: on ? "var(--surface)" : "transparent",
              }}
            >
              {t}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* EVERY STAGE SAYS WHERE IT IS. No topic → the invitation. Thinking →
            say so, because four generated questions take a beat. Nothing back →
            admit it rather than leaving a hole the reader has to interpret. */}
        {!topic ? (
          <p className="text-[11.5px] leading-snug text-[var(--text-muted)]">
            Tap a topic above to see ideas.
          </p>
        ) : isFetching && ideas.length === 0 ? (
          <p className="text-[11.5px] leading-snug text-[var(--text-muted)]">
            Writing {topic.toLowerCase()} questions…
          </p>
        ) : ideas.length === 0 ? (
          <p className="text-[11.5px] leading-snug text-[var(--text-muted)]">
            {isError
              ? "Couldn't reach the idea writer. Try another topic."
              : "Nothing sharp enough on that one — try another topic."}
          </p>
        ) : (
          <div className="space-y-2">
            {ideas.map((idea) => (
              <button
                key={idea}
                type="button"
                onClick={() => adoptQuestion(idea)}
                className="block w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left text-[13px] leading-snug text-[var(--text)] transition-colors hover:border-[var(--border-strong)]"
              >
                {idea}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
