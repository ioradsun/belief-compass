/**
 * ONE SURFACE — the question surface transforming after an answer.
 *
 * IT DECIDES NOTHING. Every branch on this page was already taken by
 * `resolvePostAction`: which sentence leads, whether a consequence line appears,
 * whether the Challenge module is offered and under which heading, what the two
 * controls say and where they go. This file turns that answer into pixels and
 * hands presses back to the caller.
 *
 * IT IS NOT A CONFIRMATION SCREEN. There is no success page, no modal, no
 * floating result layer, and no second acknowledgement of the transaction. The
 * user answered; this is the same surface responding, as ONE ordinary vertical
 * document:
 *
 *   lock → strongest consequence → social context → flexible space → controls
 *
 * NOTHING OVERLAPS, EVER. Every section is auto-height and in normal flow, so a
 * richer result only makes the page longer. The flexible space sits AFTER the
 * story and BEFORE the controls, which is why a thin result settles its buttons
 * near the bottom without opening a gap in the middle of the narrative.
 *
 * NO SYSTEM LANGUAGE. "Your branch is already live" told a first-time reader
 * about a data structure they have never heard of. The consequence is now stated
 * as a human one — people were already asked — and the mechanic is named later,
 * once it has been felt.
 */
import type { ReactNode } from "react";
import {
  WRITE_FAILED_TITLE,
  WRITE_RETRY_LABEL,
  type ActionStatus,
  type Cta,
  type PostActionExperience,
} from "@/domain/post-action";
import { AudienceGroups } from "@/components/AudiencePreview";
import type { AudienceGroupView } from "@/domain/audience";
import { RELAY_COST } from "@/domain/chain";

export interface PostActionScreenProps {
  experience: PostActionExperience;
  /** Executed as given. This component never picks a destination. */
  onAct: (cta: Cta) => void;
  /** Whether the primary is mid-flight. Never used to render a disabled CTA. */
  pending?: boolean;
  /**
   * The personal story, when the resolver asked for one. Passing it while
   * `consequence !== "reveal"` renders nothing — the resolver decides, not the
   * presence of a prop.
   */
  reveal?: ReactNode;
  /** Faces for the Challenge module. Absent while the audience is still loading. */
  groups?: AudienceGroupView[];
  /**
   * THE OUTCOME OF ONE PRESS, separate from the experience on purpose.
   *
   * A refused write changes nothing about this market or this person —
   * `put_on_table` rolls back whole. So it is rendered as a line in the flow of
   * an unchanged surface rather than by re-deciding the surface, and it
   * disappears the moment the reader tries again.
   */
  status?: ActionStatus;
  onRetry?: () => void;
}

/**
 * HUMAN CONSEQUENCE, NOT SYSTEM STATE.
 *
 * The two sentences below are the whole reason this file stopped printing
 * "branch". A reader does not have a branch; they asked some people something,
 * and those people have not all answered yet.
 */
const CONSEQUENCE_COPY: Record<"branch_live" | "challenge_live", string> = {
  branch_live: "You already asked people about this one.",
  challenge_live: "The people you asked are still deciding.",
};

/**
 * EARN THE WORD.
 *
 * "Your Tribe" is vocabulary before it is a reward. On this surface — which is
 * frequently somebody's first — the same rows are described by what is true and
 * checkable: these are people who keep landing where you land. The engine's own
 * labels survive everywhere the concept has already been demonstrated.
 */
const plainLabel = (label: string): string =>
  label === "Your Tribe" || label === "Your Twin + Tribe"
    ? "People who think like you"
    : label === "Your Rivals"
      ? "People who usually disagree"
      : label;

const plainGroups = (groups: AudienceGroupView[]): AudienceGroupView[] =>
  groups.map((g) => ({ ...g, label: plainLabel(g.label) }));

export function PostActionScreen({
  experience: x,
  onAct,
  pending = false,
  reveal,
  groups,
  status = { state: "idle" },
  onRetry,
}: PostActionScreenProps) {
  const showReveal = x.consequence === "reveal" && reveal != null;
  const consequenceText =
    x.consequence === "branch_live" || x.consequence === "challenge_live"
      ? CONSEQUENCE_COPY[x.consequence]
      : null;

  /**
   * ONE CONTROL SYSTEM, NOT TWO UNRELATED BUTTONS.
   *
   * "Challenge" and "Next question" are the two things a reader can do with what
   * they just learned: bring people in, or keep going. Keeping going is the
   * primary — it is what almost everybody wants and it must never be the small
   * grey link under a social ask. The resolver still decides WHICH actions
   * exist; this only decides which of them gets the filled button.
   */
  const ctas = [x.primary, x.secondary].filter(Boolean) as Cta[];
  const keepGoing = ctas.find((c) => c.kind === "next_question");
  const lead = keepGoing ?? x.primary;
  const others = ctas.filter((c) => c !== lead);

  return (
    /**
     * A NORMAL DOCUMENT THAT FILLS THE VIEWPORT.
     *
     * `min-h-full` on the inner column, not `h-full`: short content grows to the
     * available height so the controls settle low, long content simply keeps
     * going and the surface scrolls. There is no fixed height anywhere, so no
     * section can ever be asked to fit inside a space it does not fit in.
     */
    <section
      className="h-full w-full overflow-y-auto overscroll-contain"
      data-post-action={x.copyCategory}
    >
      <div className="flex min-h-full flex-col px-4 pt-4 pb-[max(16px,env(safe-area-inset-bottom))]">
        {/* 1 · THE LOCK — compact by design. It is the transition into the
            interesting part, not the destination, so it gets typography rather
            than a card. */}
        {x.identity && (
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
            {x.identity}
          </p>
        )}
        <h2 className="mt-0.5 text-[19px] font-semibold leading-tight text-[var(--text)]">
          {x.headline}
        </h2>
        {x.support && (
          <p className="mt-1 text-[13px] leading-snug text-[var(--text-secondary)]">{x.support}</p>
        )}

        {/* 2 · THE CONSEQUENCE — one human line, no box. At most one, ever; the
            resolver guarantees it and there is no way here to show two. */}
        {consequenceText && (
          <p className="mt-2 text-[12px] leading-snug text-[var(--text-secondary)]">
            {consequenceText}
            {/* NO FRACTION WHEN THE READ DID NOT COMPLETE. "3 of 11" is a claim
                about eleven real people, and half a checkable sentence is worse
                than the half that is certain. */}
            {x.consequenceLine && (
              <span className="text-[var(--text-muted)]"> {x.consequenceLine}</span>
            )}
          </p>
        )}

        {/* 3 · WHAT THE ANSWER REVEALED — the personal story, in flow, at its
            own natural height. */}
        {showReveal && <div className="mt-3">{reveal}</div>}

        {/* 4 · THE WIDER ROOM — the next chapter of the same story, separated by
            a hairline rather than lifted onto another card. */}
        {x.challengeModule && (
          <div className="mt-4 border-t border-[var(--border)] pt-3">
            <p className="text-[12px] font-semibold leading-snug text-[var(--text)]">
              {x.challengeModule.title}
            </p>
            {/* SOME FRAMINGS ARE STRONGER ALONE. A one-sentence hook renders as
                one sentence rather than being padded to fill a slot. */}
            {x.challengeModule.support && (
              <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--text-secondary)]">
                {x.challengeModule.support}
              </p>
            )}
            {/* FACES ONLY WHEN THERE ARE FACES. `make_room` has an audience it
                cannot reach yet, so it shows the sentence and the way out. */}
            {x.challengeModule.kind !== "make_room" && groups && groups.length > 0 && (
              <AudienceGroups groups={plainGroups(groups)} />
            )}
          </div>
        )}

        {/* THE PRESS DID NOT LAND, AND THE TABLE IS EXACTLY AS THEY LEFT IT.
            Short, and with no database in it. "Nothing changed" is the half that
            matters: the write is one transaction, so a refusal leaves nothing
            behind. Without this the button simply reappeared, unchanged,
            explaining nothing — at the emotional peak of the product. */}
        {status.state === "failed" && (
          <div
            className="mt-3 rounded-lg border p-2.5"
            style={{
              borderColor: "color-mix(in oklab, var(--no) 40%, var(--border))",
              background: "color-mix(in oklab, var(--no) 8%, transparent)",
            }}
          >
            <p className="text-[12px] font-semibold leading-snug text-[var(--text)]">
              {WRITE_FAILED_TITLE}
            </p>
            <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--text-secondary)]">
              {status.message}
            </p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="mt-1.5 text-[12px] font-medium text-[var(--text)] underline"
              >
                {WRITE_RETRY_LABEL}
              </button>
            )}
          </div>
        )}

        {/* 5 · FLEXIBLE SPACE — the only place a gap is allowed to open, and it
            is between the story and the controls rather than inside either. */}
        <div className="min-h-4 flex-1" />

        {/* 6 · ONE ACTION BAR. Two choices, side by side, in flow — never pinned
            over the content it belongs to. */}
        <div className="mt-4 border-t border-[var(--border)] pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              /**
               * NEVER RENDERED DISABLED. A control that cannot be used is a
               * smaller version of a promise that cannot be kept — the resolver
               * returns the strongest action that is actually available, so
               * there is nothing to grey out. `pending` dims an in-flight press.
               */
              disabled={pending}
              onClick={() => onAct(lead)}
              className="rounded-lg bg-[var(--text)] px-3.5 py-2 text-[13px] font-medium text-[var(--bg)] transition-opacity disabled:opacity-50"
            >
              {lead.label}
            </button>
            {others.map((c) => (
              <button
                key={c.kind}
                type="button"
                onClick={() => onAct(c)}
                className="rounded-lg border border-[var(--border)] px-3.5 py-2 text-[13px] font-medium text-[var(--text)] transition-colors hover:border-[var(--text-muted)]"
              >
                {c.label}
              </button>
            ))}
          </div>
          {/* WHAT IT COSTS, said plainly and attached to the control that spends
              it — not floating as unrelated body copy. */}
          {ctas.some((c) => c.kind === "challenge") && (
            <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">{RELAY_COST}</p>
          )}
        </div>
      </div>
    </section>
  );
}
