/**
 * THE CLOSING MOMENT, END TO END — the only thing a call site has to render.
 *
 * Adapter gathers → `resolvePostAction` decides → `PostActionScreen` draws →
 * this executes the CTA that comes back. A buy surface, a sell surface and a
 * creation surface each render this one element and hand it three things: what
 * they just confirmed, where "next" goes, and the personal story if they have
 * one. They decide nothing else.
 *
 * REMOVING THE `resolvePostAction` CALL BREAKS ALL THREE FLOWS. That is the only
 * real proof that a resolver owns a screen rather than sitting beside it: there
 * is no second path that still renders a headline, no fallback branch that
 * quietly keeps working, and no component downstream holding a spare opinion
 * about whether Challenge should appear.
 *
 * THE CHALLENGE PRESS GOES THROUGH `putOnTable` AND NOWHERE ELSE, carrying the
 * lineage pointer the adapter recovered. A refusal is reported by the server —
 * this never decides on its own that somebody was ineligible, because the
 * canonical audience already did, in the same definition the write uses.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ReactNode } from "react";
import { putOnTable } from "@/lib/table.functions";
import { railSideKey, tableKey } from "@/components/YourTable";
import { audienceKey, useAudience } from "@/components/AudiencePreview";
import { PostActionScreen } from "@/components/PostActionScreen";
import { usePostActionFacts, type ConfirmedAction } from "@/lib/post-action.adapter";
import {
  refusalIsCanonical,
  resolvePostAction,
  WRITE_FAILED_SUPPORT,
  WRITE_FAILED_TITLE,
  type ActionStatus,
  type Cta,
} from "@/domain/post-action";
import { bestEffort, useWalletSession } from "@/hooks/useWalletSession";
import type { PutResult } from "@/lib/table.server";
import type { RecordMode } from "@/domain/simulation";

export interface PostActionProps {
  kind: "buy" | "sell" | "create";
  wallet?: string;
  act: ConfirmedAction;
  /**
   * WHICH LEDGER THE ACTION LANDED IN. Defaults to REAL, so every caller that
   * has not learned about Simulation behaves exactly as before. It scopes the
   * audience, the table capacity, the relay write and the money vocabulary — a
   * Challenge put up from Simulation reaches only Simulation users, and takes a
   * Simulation slot.
   */
  mode?: RecordMode;
  /** Leave this market for the next question. Absent on a sell, by design. */
  onNextQuestion?: () => void;
  /** Stay here — the sell exit, and the creation's "View Market". */
  onStay?: () => void;
  /** Open the chain for this market, when a Challenge is live on it. */
  onSeeChain?: () => void;
  /** Go answer the person still waiting. */
  onAnswer?: () => void;
  /** The personal story, rendered only if the resolver asked for one. */
  reveal?: ReactNode;
}

export function PostAction({
  kind,
  wallet,
  act,
  mode = "REAL",
  onNextQuestion,
  onStay,
  onSeeChain,
  onAnswer,
  reveal,
}: PostActionProps) {
  const qc = useQueryClient();
  const { ensureSession } = useWalletSession();
  const { input, parentCall } = usePostActionFacts(kind, wallet, act, mode);
  const { data: audience } = useAudience(wallet, act.marketId, mode);

  /**
   * ONE PRESS'S OUTCOME, and deliberately not part of the experience.
   *
   * `put_on_table` rolls back whole, so a refusal changes nothing about this
   * market or this person — no Challenge, no spent slot, no repointed call.
   * Folding it into `resolvePostAction` would make a momentary network error
   * look like a permanent property of somebody's position. It rides alongside
   * instead, and disappears on retry.
   */
  const [status, setStatus] = useState<ActionStatus>({ state: "idle" });

  const relay = useMutation({
    mutationFn: async (): Promise<PutResult | null> =>
      bestEffort(async () =>
        putOnTable({
          data: {
            wallet: wallet as string,
            session: await ensureSession({ interactive: true }),
            marketId: act.marketId,
            /**
             * THE LINK. Without it a chain is a set of unrelated Challenges that
             * happen to share a market, and provenance has nothing to walk. The
             * server validates it — wrong market, not addressed to this person,
             * or never answered are all refused inside the transaction.
             */
            parentCall,
            mode,
          },
        }),
      ),
    onSettled: (res) => {
      /**
       * RE-READ ON EVERY OUTCOME, not only on success.
       *
       * A refusal usually means the world moved under the press — another tab
       * put this market up, the table filled, the audience shrank. Those are
       * not failures to report, they are the CANONICAL STATE arriving late, and
       * the only way the screen can say the true thing is to go and look.
       */
      void qc.invalidateQueries({ queryKey: tableKey(wallet, mode) });
      void qc.invalidateQueries({ queryKey: audienceKey(wallet, act.marketId, mode) });
      /**
       * A NULL RESULT IS A NETWORK FAILURE. `bestEffort` swallows the throw, so
       * the absence of a result is the only evidence the request never landed —
       * and it must not read as a silent success.
       */
      if (res == null) {
        setStatus({ state: "failed", message: WRITE_FAILED_SUPPORT });
        return;
      }
      if (res.ok || refusalIsCanonical(res.reason)) {
        // The refetched state explains itself: "your branch is already live",
        // a Make room offer, or an honest "nobody new to ask".
        setStatus({ state: "idle" });
        return;
      }
      setStatus({ state: "failed", message: WRITE_FAILED_SUPPORT });
    },
  });

  /**
   * THE RESOLVER SEES THE RELAY THAT JUST HAPPENED.
   *
   * A successful put makes this market `outgoing: "live"`, and re-resolving with
   * that fact is what turns the screen from an offer into "your branch is
   * already live" without a second component deciding so. The table query is
   * invalidated above; this covers the render between the press and the refetch.
   */
  const put = relay.data;
  const experience = resolvePostAction(
    put?.ok
      ? { ...input, outgoing: "live", outgoingProgress: { shown: 0, reached: put.reached } }
      : input,
  );

  const act_ = (cta: Cta) => {
    switch (cta.kind) {
      case "challenge":
        // A retry clears the previous refusal before the next attempt, so the
        // block cannot linger over a press that has since succeeded.
        setStatus({ state: "pending" });
        relay.mutate();
        return;
      case "make_room":
        // The choice of what to take down needs to see all three, which is not
        // this surface's job — it points at the table rather than arguing.
        qc.setQueryData(railSideKey, "yours");
        onStay?.();
        return;
      case "next_question":
        onNextQuestion?.();
        return;
      case "answer":
        (onAnswer ?? onNextQuestion)?.();
        return;
      case "see_chain":
        (onSeeChain ?? onStay)?.();
        return;
      case "back_to_market":
      case "view_market":
        onStay?.();
        return;
      default: {
        const never: never = cta.kind;
        throw new Error(`unhandled post-action cta: ${String(never)}`);
      }
    }
  };

  const groups = audience?.status === "available" ? audience.groups : undefined;

  /**
   * THE BAR IS THE SAME MOMENT, IN THE REGION THE ORDER FORM OCCUPIED.
   *
   * One resolver, one relay, two presentations. `surface` still owns the mobile
   * game and the create flow; `bar` keeps the market on screen and lets the
   * bottom of the interface change state instead of the page changing.
   */
  if (variant === "bar") {
    const reach = audience?.status === "available" ? audience.total : 0;
    return (
      <>
        <PostPositionBar
          experience={experience}
          lockLine={lockLine(kind, act.side ?? null, mode)}
          remaining={remaining}
          onAct={(cta) => {
            // Challenge never fires from the bar: it opens over the market so
            // the reader can see who it reaches before spending a slot.
            if (cta.kind === "challenge") return setSheet(true);
            act_(cta);
          }}
          pending={relay.isPending}
          status={status}
          onRetry={() => act_({ kind: "challenge", label: WRITE_FAILED_TITLE })}
        />
        {sheet && (
          <ChallengeSheet
            count={reach}
            groups={groups}
            remaining={remaining}
            pending={relay.isPending}
            onSend={() => {
              setStatus({ state: "pending" });
              relay.mutate(undefined, { onSettled: () => setSheet(false) });
            }}
            onClose={() => setSheet(false)}
          />
        )}
      </>
    );
  }

  return (
    <PostActionScreen
      experience={experience}
      onAct={act_}
      pending={relay.isPending}
      status={status}
      onRetry={() => act_({ kind: "challenge", label: WRITE_FAILED_TITLE })}
      reveal={reveal}
      groups={groups}
    />
  );
}

/** The plain record of what just happened. No system nouns, no mechanics. */
function lockLine(kind: "buy" | "sell" | "create", side: string | null, mode: RecordMode): string {
  const sim = mode === "SIMULATION" ? " (simulated)" : "";
  if (kind === "sell") return `Position closed${sim}.`;
  if (kind === "create") return `Your question is live${sim}.`;
  return side ? `You backed ${side}${sim}.` : `Locked in${sim}.`;
}

