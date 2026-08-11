/**
 * WHAT "SEE CHAIN" OPENS — the same sheet every other over-long list uses.
 *
 * A sheet rather than a route because a chain is something you glance at and
 * close: the reader is in the middle of their rail, and sending them to a page
 * would make provenance a destination rather than an aside.
 *
 * A REFUSED OR EMPTY READ CLOSES NOTHING AND CLAIMS NOTHING. `challengeChainFor`
 * returns null when it could not read, and this says so plainly rather than
 * rendering a chain of one — a claim about how far a question travelled, made
 * from a query that never completed.
 */
import { useQuery } from "@tanstack/react-query";
import { Sheet } from "@/components/Sheet";
import { ChallengeChainView } from "@/components/ChallengeChainView";
import { getChallengeChain } from "@/lib/challenge.functions";
import { CHAIN_TITLE, type ChallengeChainProjection } from "@/domain/challenge-chain";

export const chainKey = (wallet?: string, marketId?: number) =>
  ["challenge-chain", wallet ?? null, marketId ?? null] as const;

export function ChallengeChainSheet({
  wallet,
  marketId,
  onClose,
  onSelectMarket,
}: {
  wallet?: string;
  marketId: number;
  onClose: () => void;
  onSelectMarket?: (marketId: number) => void;
}) {
  const { data, isLoading, isError } = useQuery<ChallengeChainProjection | null>({
    queryKey: chainKey(wallet, marketId),
    queryFn: () => getChallengeChain({ data: { wallet: wallet ?? null, marketId } }),
    enabled: !!wallet,
    staleTime: 30_000,
  });

  return (
    <Sheet title={CHAIN_TITLE} onClose={onClose}>
      {isLoading ? (
        <p className="p-4 text-[12px] text-[var(--text-muted)]">Following the chain…</p>
      ) : isError || !data ? (
        /* NOT "this question has not travelled". The read did not complete, and
           those are different sentences about somebody else's reach. */
        <p className="p-4 text-[12px] leading-snug text-[var(--text-muted)]">
          Couldn&rsquo;t follow the chain just now. Nothing about it has changed.
        </p>
      ) : (
        <ChallengeChainView chain={data} onSelectMarket={onSelectMarket} />
      )}
    </Sheet>
  );
}
