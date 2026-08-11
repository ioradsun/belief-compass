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
import type { ReactNode } from "react";
import { putOnTable } from "@/lib/table.functions";
import { railSideKey, tableKey } from "@/components/YourTable";
import { audienceKey, useAudience } from "@/components/AudiencePreview";
import { PostActionScreen } from "@/components/PostActionScreen";
import { usePostActionFacts, type ConfirmedAction } from "@/lib/post-action.adapter";
import { resolvePostAction, type Cta } from "@/domain/post-action";
import { bestEffort, useWalletSession } from "@/hooks/useWalletSession";
import type { PutResult } from "@/lib/table.server";

export interface PostActionProps {
  kind: "buy" | "sell" | "create";
  wallet?: string;
  act: ConfirmedAction;
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
  onNextQuestion,
  onStay,
  onSeeChain,
  onAnswer,
  reveal,
}: PostActionProps) {
  const qc = useQueryClient();
  const { ensureSession } = useWalletSession();
  const { input, parentCall } = usePostActionFacts(kind, wallet, act);
  const { data: audience } = useAudience(wallet, act.marketId);

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
          },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: tableKey(wallet) });
      // The audience shrank by everybody just asked. Re-read rather than let a
      // stale count sit under a button that would now reach fewer people.
      void qc.invalidateQueries({ queryKey: audienceKey(wallet, act.marketId) });
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

  return (
    <PostActionScreen
      experience={experience}
      onAct={act_}
      pending={relay.isPending}
      reveal={reveal}
      groups={audience?.status === "available" ? audience.groups : undefined}
    />
  );
}
