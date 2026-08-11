/**
 * MARKETS — two sections, and the card renders what the domain decided.
 *
 * Every label, every summary line and both orderings come from `domain/markets`.
 * This file contains no test for whether the viewer created a market, no check
 * for whether they hold both sides, no Challenge arithmetic and no sort
 * comparator — all of that is exactly the logic the brief says a component must
 * not carry, and it is the logic that produced four owners of the post-action
 * moment when it lived in components before.
 *
 * MARKET MAKER FIRST, AND ONLY ONCE. `partitionMarkets` returns two arrays from
 * one pass, so a created-and-held market cannot appear in both — the component
 * could not duplicate it if it tried.
 *
 * SILENCE IS A RENDERED STATE. Every line below is `null`-guarded because the
 * domain returns null for anything unproven: unknown believers, an activity read
 * that did not complete, a missing Challenge projection. None of those print a
 * zero, and none print "no activity".
 */
import { useQuery } from "@tanstack/react-query";
import { getMarkets } from "@/lib/challenge.functions";
import {
  BELIEVER_TITLE,
  MAKER_TITLE,
  believersLine,
  challengeSummary,
  earningsLine,
  identityLabel,
  latestLine,
  partitionMarkets,
  sortBelievers,
  sortMakers,
  type MarketEntry,
} from "@/domain/markets";

export const marketsKey = (wallet?: string) => ["markets", wallet ?? null] as const;

export function useMarkets(wallet?: string) {
  return useQuery<MarketEntry[]>({
    queryKey: marketsKey(wallet),
    queryFn: () => getMarkets({ data: { wallet: wallet ?? null } }),
    enabled: !!wallet,
    staleTime: 30_000,
  });
}

function Card({ entry: e, onSelect }: { entry: MarketEntry; onSelect: (id: number) => void }) {
  const believers = believersLine(e.participation);
  const latest = latestLine(e.latest);
  const challenge = challengeSummary(e.challenge);
  const earnings = earningsLine(e.earningsUsd);

  return (
    <article className="rounded-xl border border-[var(--border)] p-3">
      {/* ROLE FIRST. It is the most consequential thing about this reader's
          relationship to the question, and on a Maker's own market it is the one
          fact a portfolio view could never state. */}
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
        {identityLabel(e.ownership, e.holding)}
      </p>
      <button
        type="button"
        onClick={() => onSelect(e.marketId)}
        className="mt-0.5 block text-left text-[13px] font-semibold leading-snug text-[var(--text)] underline-offset-2 hover:underline"
      >
        {e.question}
      </button>

      {/* HUMAN PARTICIPATION, then the latest human act, then the Challenge. */}
      {believers && <p className="mt-1 text-[12px] text-[var(--text-secondary)]">{believers}</p>}
      {latest && <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">{latest}</p>}
      {challenge && <p className="mt-0.5 text-[12px] text-[var(--text)]">{challenge}</p>}

      {/* MONEY LAST AND QUIET. A number at the top would answer a question the
          reader did not ask on a page about what is happening around theirs. */}
      {earnings && <p className="mt-1 text-[11px] text-[var(--text-muted)]">{earnings}</p>}
    </article>
  );
}

function Section({
  title,
  entries,
  onSelect,
}: {
  title: string;
  entries: MarketEntry[];
  onSelect: (id: number) => void;
}) {
  // A heading over nothing points at a category the reader does not have.
  if (entries.length === 0) return null;
  return (
    <section>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
        {title}
      </p>
      <div className="mt-1.5 flex flex-col gap-2">
        {entries.map((e) => (
          <Card key={e.marketId} entry={e} onSelect={onSelect} />
        ))}
      </div>
    </section>
  );
}

export function MarketsPanel({
  wallet,
  onSelectMarket,
}: {
  wallet?: string;
  onSelectMarket: (marketId: number) => void;
}) {
  const { data, isError } = useMarkets(wallet);

  /**
   * A FAILED READ IS NOT AN EMPTY PAGE. "You have no markets" to somebody with
   * twelve of them is the confident zero this codebase keeps paying for, and on
   * this surface it reads as having lost their work.
   */
  if (isError)
    return (
      <p className="p-3 text-[12px] leading-snug text-[var(--text-muted)]">
        Couldn&rsquo;t load your markets just now. Nothing has changed.
      </p>
    );
  if (!data) return null;

  const { makers, believers } = partitionMarkets(data);

  return (
    <div className="flex flex-col gap-4">
      {/* MARKET MAKER FIRST, ALWAYS. */}
      <Section title={MAKER_TITLE} entries={sortMakers(makers)} onSelect={onSelectMarket} />
      <Section
        title={BELIEVER_TITLE}
        entries={sortBelievers(believers)}
        onSelect={onSelectMarket}
      />
    </div>
  );
}
