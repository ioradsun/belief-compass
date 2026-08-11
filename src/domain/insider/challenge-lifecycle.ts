/**
 * THE REST OF A CHALLENGE'S LIFE, TURNED INTO EVENTS — pure, from the canonical
 * card projection and nothing else.
 *
 * WHAT THIS EXISTS TO FIX. The tape could say exactly one thing about a
 * Challenge: somebody answered. A branch that travelled two links and then
 * finished produced one row on the day it started and silence afterwards, which
 * reads as a question nobody picked up — the opposite of what happened.
 *
 * IT DECIDES NOTHING AND COUNTS NOTHING. Every number here is lifted off the
 * `ChallengeCardProjection` the durable card renders, and every sentence is
 * written by `semanticEvent`. This file's whole job is to say WHICH moments in a
 * card's life are worth a row and WHEN each of them happened — a selection, not
 * a second lifecycle.
 *
 * ZERO IO, pure, fully testable.
 */
import type { ChallengeCardProjection } from "@/domain/challenge-card";
import type { ChallengeEventInput } from "@/domain/insider/challenge-events";

export interface LifecycleContext {
  /** The reader. A completion is their own Challenge, so the row says "YOUR". */
  viewerWallet: string;
  /** Nothing older than this is news. */
  freshAfterMs: number;
}

/**
 * WHEN A CHALLENGE FINISHED, or zero when nothing proves it did.
 *
 * `closed_at` when the creator took it down. Otherwise the last answer, because
 * a Challenge that completed BECAUSE everybody answered has no closure stamp of
 * its own — the lifecycle ended, nobody ended it.
 *
 * ZERO IS A REAL ANSWER and it means "do not print this". A completion dated
 * `now` would put a week-old ending at the top of the tape.
 */
export function completedAtMs(out: ChallengeCardProjection["outgoing"]): number {
  if (!out) return 0;
  if (out.closedAtMs != null && out.closedAtMs > 0) return out.closedAtMs;
  if (out.reached > 0 && out.waiting === 0)
    return out.responders.reduce((m, r) => Math.max(m, r.atMs > 0 ? r.atMs : 0), 0);
  return 0;
}

/**
 * THE MOMENTS WORTH A ROW.
 *
 * A relay per person who kept it moving, and one completion per Challenge that
 * ended. Answers are deliberately NOT here: `showedUpForMe` already emits them,
 * aggregated one row per market, because three people answering in one market is
 * one thing that happened to the reader and a row each would make the tape
 * loudest on their best day. Relays and completions are already one per person
 * and one per Challenge, so there is nothing to collapse.
 */
export function lifecycleEvents(
  cards: readonly ChallengeCardProjection[],
  { viewerWallet, freshAfterMs }: LifecycleContext,
): ChallengeEventInput[] {
  const me = viewerWallet.trim().toLowerCase();
  const out: ChallengeEventInput[] = [];
  if (!me) return out;

  for (const c of cards) {
    const o = c.outgoing;
    if (!o) continue;

    for (const r of o.relayers) {
      /**
       * AN UNDATED RELAY IS NOT DATED WITH `NOW`. A chronological tape places a
       * row by when the thing happened, and a row placed by when the page was
       * built is a row claiming something just occurred. Dropping it loses one
       * entry; keeping it corrupts the order of every entry around it.
       */
      if (!(r.atMs > 0) || r.atMs < freshAfterMs) continue;
      out.push({
        kind: "relay",
        marketId: c.marketId,
        actor: { wallet: r.wallet, name: r.name },
        atMs: r.atMs,
        /**
         * THIS ACT'S REACH, NOT THE BRANCH TOTAL and not the person's lifetime
         * total. `relayReach` sums every relayer's tables; spending it on one
         * row credits somebody with tables other people opened.
         */
        relayReach: r.reach,
        /**
         * ONE ROW PER ACT, AND THE COLLAPSE MUST AGREE. `collapseEvents` keys by
         * (market, actor), which is right for a trade and its answer stamp and
         * wrong here: a person who put the question up, took it down and put it
         * up again did two things on two days. Merged, they would read as one
         * relay carrying both reaches at the later timestamp.
         */
        actKey: `relay:${r.challengeId}`,
      });
    }

    /**
     * COMPLETION IS THE LIFECYCLE'S WORD, NOT ARITHMETIC HERE — the card already
     * decided `finished`, and this only asks when.
     *
     * A CLOSED MARKET IS REFUSED AS A COMPLETION. `marketClosed` is hardcoded
     * false until an indexer supplies it, and the rule this codebase keeps
     * paying to hold is that Conviction OBSERVES closure rather than declaring
     * it. A row announcing a completed Challenge on the strength of an unproven
     * closure would be that inference wearing a headline.
     */
    if (c.state !== "finished" || c.marketClosed) continue;
    const doneAt = completedAtMs(o);
    if (!(doneAt > 0) || doneAt < freshAfterMs) continue;
    out.push({
      kind: "challenge_complete",
      marketId: c.marketId,
      actor: { wallet: me, name: "You" },
      atMs: doneAt,
      completion: { showedUp: o.showedUp, reached: o.reached },
      // One per Challenge, and named so it can never merge with a relay the
      // reader happened to make on their own branch.
      actKey: `complete:${o.challengeId}`,
    });
  }
  return out;
}
