/**
 * ONE CARD, SWITCHING ON ONE STATE — and reconstructing nothing.
 *
 * Every branch below reads `projection.state`, which the server already
 * decided. This file contains no arithmetic over `market_calls`, no comparison
 * of counts to work out whether somebody is waiting, and no second opinion
 * about whether a relay is possible. If it ever grows one, the rail has started
 * down the road post-action already went: five components, five truths, none
 * able to see the others.
 *
 * `canRelay` IS TOLD, NEVER DERIVED. It comes from `eligibleAudience` on the
 * server — the same function `put_on_table` resolves against — so the offer
 * shown here and the write it triggers cannot disagree. `KeepChainMoving` was
 * deleted for computing its own answer; this must not become where that comes
 * back.
 */
import { useEffect, useRef, useState } from "react";
import { PersonAvatar } from "@/components/PersonAvatar";
import { RELAY_COST } from "@/domain/chain";
/**
 * THE SAME LABEL RULES AS THE CLOSING SCREEN. One person with a name is
 * "Challenge Maya", two is "Challenge both", three or more is "Challenge all N".
 * This surface rendered "Challenge all 1" until it borrowed the canonical
 * helper — a second labelling rule for the same button.
 */
import { challengeLabel } from "@/domain/post-action";
import { REMOVED_HEADLINE, REMOVED_SUPPORT } from "@/domain/challenge-card";
import {
  RELAY_TITLE,
  broughtYouIn,
  completionFor,
  keptItMovingHeadline,
  keptItMovingLine,
  lineageLine,
  progressLine,
  relayInvitation,
  responseHeadline,
  responseSideLine,
  tablesLine,
  youShowedUpFor,
  type CardPerson,
  type ChallengeCardProjection,
} from "@/domain/challenge-card";

function Faces({ people, max = 5 }: { people: readonly CardPerson[]; max?: number }) {
  const shown = people.slice(0, max);
  const overflow = Math.max(0, people.length - max);
  if (shown.length === 0) return null;
  return (
    <div className="flex shrink-0 -space-x-1.5">
      {shown.map((p) => (
        <PersonAvatar
          key={p.wallet}
          wallet={p.wallet}
          name={p.name}
          avatarUrl={p.avatarUrl}
          size={22}
          className="ring-1 ring-[var(--bg)]"
        />
      ))}
      {/* A COUNT, NEVER A SILHOUETTE. A generic face standing in for four real
          people is filler wearing a person's shape. */}
      {overflow > 0 && (
        <span
          className="flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1 text-[10px] font-medium ring-1 ring-[var(--bg)]"
          style={{
            background: "color-mix(in oklab, var(--text-muted) 16%, transparent)",
            color: "var(--text-secondary)",
          }}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

/**
 * A NEW RESPONSE ARRIVES ONCE, QUIETLY.
 *
 * Somebody answering is the payoff this whole system exists to produce, and it
 * deserves to be noticed — but it happens on a card the reader may be scrolling
 * past, and a celebration that fires on every render becomes wallpaper. This is
 * a neutral highlight that decays: keyed on the newest responder, fired once per
 * new name, and honoured `prefers-reduced-motion` by being a colour fade rather
 * than movement. No confetti.
 */
function useFreshResponse(newestResponderWallet: string | undefined): boolean {
  const seen = useRef<string | null>(null);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (!newestResponderWallet) return;
    // The first render of a card the reader is only now opening is not news.
    if (seen.current == null) {
      seen.current = newestResponderWallet;
      return;
    }
    if (seen.current === newestResponderWallet) return;
    seen.current = newestResponderWallet;
    setFresh(true);
    const t = setTimeout(() => setFresh(false), 2400);
    return () => clearTimeout(t);
  }, [newestResponderWallet]);
  return fresh;
}

export interface ChallengeCardProps {
  projection: ChallengeCardProjection;
  /** Open the market. The card never navigates on its own. */
  onSelect: (marketId: number) => void;
  /** "Not for me" — only ever offered while the viewer is the one being asked. */
  onPass?: (marketId: number) => void;
  /** Put it in front of my people. Uses the canonical audience and the RPC. */
  onRelay?: (projection: ChallengeCardProjection) => void;
  /** Take my own Challenge down. Frees the slot; erases nothing. */
  onRemove?: (challengeId: number) => void;
  /** Open the lineage. #298 builds the real view; this is the entry point. */
  onSeeChain?: (marketId: number) => void;
  relayPending?: boolean;
  /**
   * JUST TAKEN DOWN — transient, and deliberately not in the projection.
   *
   * "Off the table. One Challenge spot opened." is a fact about a press, not
   * about the market: a moment later the card is simply finished, and a reader
   * arriving fresh must not be told about a removal they did not perform. Same
   * reasoning as the post-action write status.
   */
  justRemoved?: boolean;
}

export function ChallengeCard({
  projection: p,
  onSelect,
  onPass,
  onRelay,
  onRemove,
  onSeeChain,
  relayPending = false,
  justRemoved = false,
}: ChallengeCardProps) {
  const out = p.outgoing;
  const fresh = useFreshResponse(out?.responders[0]?.wallet);

  /**
   * THE HEADLINE IS THE STATE'S, and only one can be true at a time. The
   * `switch` is exhaustive over `CardState` so a seventh state lands here as a
   * compile error rather than an empty card.
   */
  let headline: string | null = null;
  let support: string | null = null;
  switch (p.state) {
    case "waiting":
      headline = p.incoming && broughtYouIn(p.incoming.callers);
      support =
        p.incoming?.primaryCaller && p.incoming.primaryCallerSide
          ? `${p.incoming.primaryCaller.name} backed ${p.incoming.primaryCallerSide}.`
          : null;
      break;
    case "showed_up":
      headline = p.incoming && youShowedUpFor(p.incoming.callers);
      support = p.incoming?.respondedSide ? `You backed ${p.incoming.respondedSide}.` : null;
      break;
    case "branch_live":
      headline = "Your branch is live";
      support = out && tablesLine(out.reached);
      break;
    case "people_showing_up":
      headline = out && responseHeadline(out.responders);
      support =
        out && out.responders.length === 1
          ? responseSideLine(out.responders[0], p.incoming?.respondedSide ?? null)
          : null;
      break;
    case "chain_moving":
      headline = out && keptItMovingHeadline(out.relayers);
      support = out && keptItMovingLine(out.relayers, out.relayReach);
      break;
    case "finished": {
      const done = out ? completionFor(out) : null;
      headline = p.marketClosed ? "The market closed" : (done?.headline ?? null);
      support = p.marketClosed ? "The chain remains in your history." : (done?.support ?? null);
      break;
    }
    default: {
      const never: never = p.state;
      throw new Error(`unhandled card state: ${String(never)}`);
    }
  }

  const progress = out && progressLine(out);
  const lineage = lineageLine(p.lineage);
  const relayLine = p.viewer.canRelay ? relayInvitation(p.viewer.relayAudience) : null;

  return (
    <article
      className="rounded-xl border p-3 transition-colors duration-700"
      /**
       * NEUTRAL, AND THAT IS THE WHOLE POINT. This used to tint with `--yes`,
       * which quietly turned "somebody showed up" into a YES-coded event even
       * when Casey answered NO — Showing Up is side-blind everywhere else, and a
       * highlight that agrees with one side is the same claim made in colour.
       */
      style={{
        borderColor: fresh ? "var(--border-strong,var(--text-muted))" : "var(--border)",
        background: fresh
          ? "color-mix(in oklab, var(--text-muted) 10%, transparent)"
          : "transparent",
      }}
      data-card-state={p.state}
    >
      {/* THE CONFIRMATION FOR THE PRESS THAT JUST HAPPENED, above the settled
          state and gone shortly after. The slot is already back. */}
      {justRemoved && (
        <div className="mb-2 rounded-lg border border-[var(--border)] p-2">
          <p className="text-[12px] font-semibold leading-snug text-[var(--text)]">
            {REMOVED_HEADLINE}
          </p>
          <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--text-secondary)]">
            {REMOVED_SUPPORT}
          </p>
        </div>
      )}
      {headline && (
        <p className="text-[13px] font-semibold leading-snug text-[var(--text)]">{headline}</p>
      )}
      {support && (
        <p className="mt-0.5 text-[12px] leading-snug text-[var(--text-secondary)]">{support}</p>
      )}

      {/* THE QUESTION ITSELF — the reason any of the above matters, and the one
          thing on the card that is not about people. */}
      <button
        type="button"
        onClick={() => onSelect(p.marketId)}
        className="mt-1.5 block text-left text-[13px] leading-snug text-[var(--text)] underline-offset-2 hover:underline"
      >
        {p.question}
      </button>

      {p.state === "people_showing_up" && out && out.responders.length > 1 && (
        <div className="mt-2">
          <Faces people={out.responders} />
        </div>
      )}
      {p.state === "chain_moving" && out && out.relayers.length > 0 && (
        <div className="mt-2">
          <Faces people={out.relayers} />
        </div>
      )}

      {/* WHO ANSWERED AND WHICH WAY, NAMED. A responder took a public on-chain
          position; a passer is counted in the line below and never appears here. */}
      {progress && <p className="mt-1.5 text-[11.5px] text-[var(--text-muted)]">{progress}</p>}

      {relayLine && (
        <div className="mt-2.5 border-t border-[var(--border)] pt-2.5">
          <p className="text-[12px] font-semibold leading-snug text-[var(--text)]">{RELAY_TITLE}</p>
          <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--text-secondary)]">
            {relayLine}
          </p>
          <button
            type="button"
            disabled={relayPending}
            onClick={() => onRelay?.(p)}
            className="mt-1.5 text-[12px] font-medium text-[var(--text)] underline transition-opacity disabled:opacity-50"
          >
            {challengeLabel({
              status: "available",
              total: p.viewer.relayAudience,
              singleRecipientName: p.viewer.relayRecipientName,
              formingOnly: false,
            })}
          </button>
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">{RELAY_COST}</p>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-3">
        {lineage && <span className="text-[11px] text-[var(--text-muted)]">{lineage}</span>}
        {lineage && onSeeChain && (
          <button
            type="button"
            onClick={() => onSeeChain(p.marketId)}
            className="text-[11px] text-[var(--text-muted)] underline hover:text-[var(--text)]"
          >
            See chain
          </button>
        )}
        {/* PASSING IS OFFERED ONLY WHILE SOMEBODY IS ACTUALLY ASKING. */}
        {p.state === "waiting" && onPass && (
          <button
            type="button"
            onClick={() => onPass(p.marketId)}
            className="text-[11px] text-[var(--text-muted)] underline hover:text-[var(--text)]"
          >
            Not for me
          </button>
        )}
        {/* TAKING IT DOWN FREES THE SLOT AND ERASES NOTHING — the responses,
            their sides, and every downstream branch survive. */}
        {out && out.closedAtMs == null && onRemove && (
          <button
            type="button"
            onClick={() => onRemove(out.challengeId)}
            className="text-[11px] text-[var(--text-muted)] underline hover:text-[var(--text)]"
          >
            Take it off the table
          </button>
        )}
      </div>
    </article>
  );
}
