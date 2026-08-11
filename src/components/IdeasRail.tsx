/**
 * MARKET IDEAS — the left rail while a market is being written.
 *
 * THE RAILS CHANGE JOBS AS THE STORY MOVES:
 *
 *   LEFT    Market ideas          — this
 *   CENTRE  What do you believe?  — the question, the side, the amount
 *   RIGHT   Other ways to ask · Already being debated
 *
 * WHY THIS IS NO LONGER JUST THE HOUSE SPARK. The personalized suggestion is
 * earned: it needs a connected wallet, real answer history, and a generator run.
 * Most people opening the composer have none of that, so the column rendered
 * nothing at all — the emptiest possible answer to the hardest screen in the
 * product, a blank form with no subject.
 *
 * So the rail always has something to do. If the House has an idea for this
 * reader it leads, because personal beats generic. Underneath, a short list of
 * topics — the ones people actually argue about — each generating four
 * genuinely contested questions on demand. Nothing is generated until a topic is
 * pressed: an idea nobody asked for is noise, and four of them is a feed.
 *
 * PRESSING AN IDEA NEVER DESTROYS WORDS. Ideas are adopted through
 * `adoptQuestion`, the same in-place channel the alternates rail uses, so the
 * question field is replaced but the side, amount and attachment survive. The
 * House card keeps its stricter rule (full draft reset) and so keeps hiding its
 * button once the writer has started a sentence of their own.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adoptQuestion, getDraft } from "@/lib/create-draft";
import { suggestTopicIdeas } from "@/lib/market-create.functions";
import type { ReadySuggestion } from "@/lib/market-suggestion.server";

/**
 * The topics, chosen for argument rather than coverage. Each one reliably
 * produces questions where a thoughtful person can take either side — which is
 * the only property a market needs.
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
  /** The personalized House idea, or null — the topics stand on their own. */
  suggestion: ReadySuggestion | null;
  onUse: () => void;
  onDismiss: () => void;
}) {
  const [topic, setTopic] = useState<string | null>(null);

  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ["topic-ideas", topic],
    queryFn: () => suggestTopicIdeas({ data: { topic: topic ?? "" } }),
    enabled: !!topic,
    // The same topic asked twice in a session should not cost a second call.
    staleTime: 10 * 60_000,
  });
  const ideas = data?.ideas ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-1 shrink-0 text-[11px] font-semibold tracking-wide text-[var(--text-muted)] uppercase">
        Market ideas
      </div>
      {/* WHAT THIS COLUMN IS FOR, said once. The reader is looking at a blank
          form; the rail states its job rather than making them infer it. */}
      <p className="mb-3 shrink-0 text-[11.5px] leading-snug text-[var(--text-secondary)]">
        Pick a topic and we&apos;ll draft questions people can genuinely disagree on.
      </p>

      {suggestion ? <HouseIdea suggestion={suggestion} onUse={onUse} onDismiss={onDismiss} /> : null}

      <div className="mb-3 flex flex-wrap gap-1.5">
        {TOPICS.map((t) => {
          const active = t === topic;
          return (
            <button
              key={t}
              type="button"
              onClick={() => setTopic(active ? null : t)}
              className={`rounded-full border px-2.5 py-1 text-[11.5px] transition-colors ${
                active
                  ? "border-[var(--border-strong)] bg-[var(--surface)] text-[var(--text)]"
                  : "border-[var(--border)] text-[var(--text-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--text)]"
              }`}
            >
              {t}
            </button>
          );
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Status
          topic={topic}
          loading={isFetching}
          failed={isError || (!isFetching && !!topic && ideas.length === 0)}
          onRetry={() => void refetch()}
        />

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

        {ideas.length > 0 && (
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="mt-2 text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)] disabled:opacity-50"
          >
            {isFetching ? "Thinking…" : "Four more"}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * EVERY STAGE SAYS WHERE IT IS. Silence is honest only when the reader knows
 * nothing was asked for; here they pressed a topic and are owed a state.
 */
function Status({
  topic,
  loading,
  failed,
  onRetry,
}: {
  topic: string | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
}) {
  if (!topic)
    return (
      <p className="mb-2 text-[11.5px] leading-snug text-[var(--text-muted)]">
        No topic chosen yet — or just start typing in the middle and ignore this column.
      </p>
    );
  if (loading)
    return (
      <p className="mb-2 text-[11.5px] leading-snug text-[var(--text-muted)]">
        Writing {topic.toLowerCase()} questions…
      </p>
    );
  if (failed)
    return (
      <p className="mb-2 text-[11.5px] leading-snug text-[var(--text-muted)]">
        Couldn&apos;t draft any just now.{" "}
        <button
          type="button"
          onClick={onRetry}
          className="underline underline-offset-2 transition-colors hover:text-[var(--text)]"
        >
          Try again
        </button>
      </p>
    );
  return (
    <p className="mb-2 text-[11.5px] leading-snug text-[var(--text-muted)]">
      Tap one to load it into your question — you can still edit every word.
    </p>
  );
}

/** The personalized spark, when this reader has earned one. */
function HouseIdea({
  suggestion,
  onUse,
  onDismiss,
}: {
  suggestion: ReadySuggestion;
  onUse: () => void;
  onDismiss: () => void;
}) {
  // Read at render rather than held in state: the draft is written by the form
  // next door, and a stale copy here would offer to overwrite a question that
  // now exists.
  const writing = getDraft().question.trim().length > 0;

  return (
    <div className="mb-4 shrink-0">
      <div className="mb-1.5 text-[11px] font-semibold tracking-wide text-[var(--text-muted)] uppercase">
        Picked for you
      </div>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
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
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-2 text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
      >
        Not this one
      </button>
    </div>
  );
}
