/**
 * THE RAIL'S ONE SOCIAL OBJECT — every Challenge relationship, one card each.
 *
 * WHAT THIS REPLACES. The rail rendered incoming calls through `ChainList` and
 * outgoing Challenges through `YourTable`, which meant a reader who had been
 * brought in AND put the same question up saw two cards about one relationship,
 * on two different tabs, neither aware of the other. `challengeCardsFor` merges
 * them by market; this renders one card per projection.
 *
 * IT OWNS THE ACTIONS AND NONE OF THE DECISIONS. Relay goes through the same
 * `put_on_table` the closing screen uses, carrying the same lineage pointer;
 * removal goes through `takeOffTable`. Whether either is OFFERED was decided on
 * the server, from the canonical audience, before this component existed.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getChallengeCards } from "@/lib/challenge.functions";
import { putOnTable, takeOffTable } from "@/lib/table.functions";
import { ChallengeCard } from "@/components/ChallengeCard";
import { ChallengeChainSheet } from "@/components/ChallengeChainSheet";
import { tableKey } from "@/components/YourTable";
import { bestEffort, useWalletSession } from "@/hooks/useWalletSession";
import type { ChallengeCardProjection } from "@/domain/challenge-card";

export const cardsKey = (wallet?: string) => ["challenge-cards", wallet ?? null] as const;

export function useChallengeCards(wallet?: string) {
  return useQuery<ChallengeCardProjection[]>({
    queryKey: cardsKey(wallet),
    queryFn: () => getChallengeCards({ data: { wallet: wallet ?? null } }),
    enabled: !!wallet,
    staleTime: 30_000,
  });
}

export function ChallengeCardList({
  wallet,
  limit,
  onSelect,
  onPass,
  onSeeChain,
}: {
  wallet?: string;
  limit?: number;
  onSelect: (marketId: number) => void;
  onPass?: (marketId: number) => void;
  /**
   * Override where "See chain" goes. Omitted, the list opens the sheet itself —
   * a chain is something you glance at and close, not a destination.
   */
  onSeeChain?: (marketId: number) => void;
}) {
  const qc = useQueryClient();
  const { ensureSession } = useWalletSession();
  const { data: cards } = useChallengeCards(wallet);
  /**
   * WHICH MARKET WAS JUST TAKEN DOWN — transient, and never in the projection.
   *
   * The confirmation is a fact about a PRESS, not about the market. A moment
   * later the card is simply finished, and a reader arriving fresh must not be
   * told about a removal they did not perform.
   */
  const [justRemoved, setJustRemoved] = useState<number | null>(null);
  const [chainFor, setChainFor] = useState<number | null>(null);

  /** Both writes invalidate the same key, because both change every card. */
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: cardsKey(wallet) });
    void qc.invalidateQueries({ queryKey: tableKey(wallet) });
  };

  const relay = useMutation({
    mutationFn: async (p: ChallengeCardProjection) =>
      bestEffort(async () =>
        putOnTable({
          data: {
            wallet: wallet as string,
            session: await ensureSession({ interactive: true }),
            marketId: p.marketId,
            /**
             * THE DISPLAYED PRIMARY CALLER IS THE LINEAGE PARENT. The projection
             * decided which call that is — earliest still-active — and the same
             * row is shown first, credited, and written here. Recomputing it
             * would be the second rule that lets the visible line and the
             * permanent record disagree.
             */
            parentCall: p.incoming?.primaryCall ?? null,
          },
        }),
      ),
    onSettled: refresh,
  });

  const remove = useMutation({
    mutationFn: async ({ challengeId }: { challengeId: number; marketId: number }) =>
      bestEffort(async () =>
        takeOffTable({
          data: {
            wallet: wallet as string,
            session: await ensureSession({ interactive: true }),
            challengeId,
          },
        }),
      ),
    onSuccess: (_res, { marketId }) => {
      setJustRemoved(marketId);
      // Long enough to read, short enough that it is gone before the reader
      // comes back to a card that is now simply finished.
      setTimeout(() => setJustRemoved((m) => (m === marketId ? null : m)), 4000);
    },
    onSettled: refresh,
  });

  if (!wallet || !cards || cards.length === 0) return null;
  const shown = limit != null ? cards.slice(0, limit) : cards;

  return (
    <div className="flex flex-col gap-2">
      {shown.map((p) => (
        <ChallengeCard
          key={p.marketId}
          projection={p}
          onSelect={onSelect}
          onPass={onPass}
          onRelay={(x) => relay.mutate(x)}
          onRemove={(id) => remove.mutate({ challengeId: id, marketId: p.marketId })}
          onSeeChain={onSeeChain ?? setChainFor}
          relayPending={relay.isPending}
          justRemoved={justRemoved === p.marketId}
        />
      ))}
      {chainFor != null && (
        <ChallengeChainSheet
          wallet={wallet}
          marketId={chainFor}
          onClose={() => setChainFor(null)}
          onSelectMarket={(id) => {
            setChainFor(null);
            onSelect(id);
          }}
        />
      )}
    </div>
  );
}
