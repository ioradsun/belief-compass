/**
 * THE ONE CLOSING SCREEN — buy, sell and create, rendered from one decision.
 *
 * IT DECIDES NOTHING. Every branch on this page was already taken by
 * `resolvePostAction`: which sentence leads, whether a consequence block
 * appears, whether the Challenge module is offered and under which heading,
 * what the two buttons say and where they go. This file turns that answer into
 * pixels and hands presses back to the caller.
 *
 * WHY THAT MATTERS MORE THAN IT SOUNDS. The moment after a trade used to be
 * assembled by whichever of four components happened to render — `ConvictionReveal`
 * picked the personal story AND the navigation, `KeepChainMoving` decided
 * eligibility on its own, `LaunchRail` owned the post-create decision, and the
 * route invented its own exits. None could see the others, so a state nobody had
 * thought about produced whatever fell out. Those components still draw; what
 * they no longer do is choose.
 *
 * THE REVEAL IS A SLOT, NOT A COMPETITOR. `consequence: "reveal"` means the
 * resolver decided the personal story is the strongest thing left to say, so the
 * caller passes it in and it renders here — below the headline, above the
 * social module, with no CTA of its own.
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
   * `put_on_table` rolls back whole. So it is rendered as a block ON TOP of an
   * unchanged screen rather than by re-deciding the screen, and it disappears
   * the moment the reader tries again.
   */
  status?: ActionStatus;
  onRetry?: () => void;
}

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
  const showConsequenceBlock =
    x.consequence === "branch_live" || x.consequence === "challenge_live";

  return (
    /**
     * HEIGHT IS A CONSTRAINT, NOT AN ASSUMPTION.
     *
     * This screen used to be one column that grew as tall as its content and
     * trusted the viewport to be tall enough. On a short window — a laptop with
     * browser chrome, a phone in landscape, a split screen — the story ran past
     * the bottom and took the ONE thing the screen exists for with it: the way
     * out. A confirmation whose button is below the fold is a dead end.
     *
     * So the moment is split into two jobs. The story SCROLLS in whatever room
     * there is (`min-h-0` is what actually lets a flex child shrink below its
     * content), and the actions are PINNED to the bottom of the panel where they
     * are reachable at any height. Nothing is hidden, nothing is truncated, and
     * the exit is always one press away.
     */
    <section
      className="flex h-full min-h-0 w-full flex-col"
      data-post-action={x.copyCategory}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-4">
        {/* MARKET MAKER FIRST. A creator who also backed their question is both,
          and the authorship is the larger fact — this badge is the one place the
          screen refuses to reduce them to a believer. */}
          and the authorship is the larger fact — this badge is the one place the
          screen refuses to reduce them to a believer. */}
      {x.identity && (
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
          {x.identity}
        </p>
      )}

      <div>
        <h2 className="text-[19px] font-semibold leading-tight text-[var(--text)]">{x.headline}</h2>
        {x.support && (
          <p className="mt-1 text-[13px] leading-snug text-[var(--text-secondary)]">{x.support}</p>
        )}
      </div>

      {/* AT MOST ONE CONSEQUENCE BLOCK, EVER. The resolver guarantees it; this
          renders whichever one it chose and has no way to show two. */}
      {showConsequenceBlock && (
        <div className="rounded-lg border border-[var(--border)] p-2.5">
          <p className="text-[12px] font-semibold leading-snug text-[var(--text)]">
            {x.consequence === "branch_live"
              ? "Your branch is already live"
              : "Your Challenge is still live"}
          </p>
          {/* NO FRACTION WHEN THE READ DID NOT COMPLETE. "3 of 11" is a claim
              about eleven real people, and half a checkable sentence is worse
              than the half that is certain. */}
          {x.consequenceLine && (
            <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--text-secondary)]">
              {x.consequenceLine}
            </p>
          )}
        </div>
      )}

      {showReveal && <div className="min-h-0">{reveal}</div>}

      {x.challengeModule && (
        <div className="border-t border-[var(--border)] pt-3">
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
            <AudienceGroups groups={groups} />
          )}
        </div>
      )}

      {/* THE PRESS DID NOT LAND, AND THE TABLE IS EXACTLY AS THEY LEFT IT.
          Short, and with no database in it. "Nothing changed" is the half that
          matters: the write is one transaction, so a refusal leaves no
          Challenge, no spent slot and no repointed call. Without this the
          button simply reappeared, unchanged, explaining nothing — at the
          emotional peak of the product. */}
      {status.state === "failed" && (
        <div
          className="rounded-lg border p-2.5"
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
      </div>

      {/* THE WAY OUT, ALWAYS ON SCREEN. Pinned outside the scroller so the
          height of the story can never decide whether the reader can leave. */}
      <div className="shrink-0 border-t border-[var(--border)] bg-[var(--panel,var(--bg))] px-4 py-3">
        <div className="flex flex-col items-start gap-1.5">
          <button
            type="button"
            /**
             * NEVER RENDERED DISABLED. A CTA that cannot be used is a smaller
             * version of a promise that cannot be kept — the resolver returns the
             * strongest action that is actually available, so there is nothing to
             * grey out. `pending` dims an in-flight press and nothing else.
             */
            disabled={pending}
            onClick={() => onAct(x.primary)}
            className="rounded-lg bg-[var(--text)] px-3 py-1.5 text-[13px] font-medium text-[var(--bg)] transition-opacity disabled:opacity-50"
          >
            {x.primary.label}
          </button>
          {/* WHAT IT COSTS, said plainly — and only beside an offer that spends
              one. Not a balance to watch run down. */}
          {x.primary.kind === "challenge" && (
            <p className="text-[11px] text-[var(--text-muted)]">{RELAY_COST}</p>
          )}
          {x.secondary && (
            <button
              type="button"
              onClick={() => onAct(x.secondary as Cta)}
              className="text-[12px] text-[var(--text-muted)] underline transition-colors hover:text-[var(--text)]"
            >
              {x.secondary.label}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
