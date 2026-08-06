/**
 * YOUR PEOPLE — one continuous list, ordered by relationship.
 *
 * IT WAS TWO LISTS, and the split was the bug. Someone at 56% alignment and
 * someone at 44% sat in DIFFERENT TABS twelve points apart; someone at 56% and
 * someone at 96% shared a tab forty points apart. The navigation contradicted
 * the data, and the reader had to hold two rankings in their head to answer one
 * question: who is closest to me?
 *
 * Worse, the same printed number meant opposite things on the two tabs —
 * `alignmentPct` on Tribe, `oppositionPct` on Rivals — so "70%" was agreement in
 * one place and disagreement in the other. Two lists made that survivable. One
 * list makes it a lie, so there is now exactly ONE number here: MATCH, always
 * how often you agree, never flipped.
 *
 * And the middle of the spectrum had NOWHERE TO BE. `presentRelationship`
 * classifies 45–55% as `neutral`, and neither tab rendered it: a whole cohort of
 * real people, with real shared convictions, were computed and shown to nobody.
 * They are the middle of this list.
 *
 * THE ORDER IS THE ONLY CONTROL, and it is not exposed. src/domain/relationship-
 * spectrum damps every position by confidence, so a 100%-on-two-convictions
 * match cannot outrank a 92%-on-thirty — it sits mid-list, in a neutral colour,
 * where its evidence puts it. Certainty at the ends, uncertainty in the middle.
 * Nothing to sort, nothing to filter, nothing to learn.
 *
 * SEARCH ARRIVES WHEN THE LIST GETS LONG, never because the page loaded. Below
 * `SPECTRUM.searchAt` people, reading every row is faster than deciding what to
 * type, and a permanently-mounted box is a tax paid for a rare need.
 *
 * Presentation only: getNetwork owns the data; the pure domain modules turn it
 * into one honest story.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { networkQO } from "@/lib/network-query";
import { type NetworkPersonRow } from "@/lib/dna.functions";
import { hueFor, initialsFor } from "@/lib/wallet-identity";
import { WalletConnectButton } from "@/components/WalletConnect";
import { presentRelationship, type RelationshipPresentation } from "@/domain/relationship";
import {
  place,
  bandLabel,
  compareSpectrum,
  spectrumColor,
  needsSearch,
  type SpectrumPlace,
} from "@/domain/relationship-spectrum";

interface PersonView {
  row: NetworkPersonRow;
  rel: RelationshipPresentation;
  spot: SpectrumPlace;
}

const present = (row: NetworkPersonRow): PersonView => {
  const rel = presentRelationship({
    agreement: row.agreement,
    sharedConvictions: row.sharedBeliefs,
    together: row.together,
    apart: row.apart,
    topicCount: row.topicCount,
    strongestAlignedTopic: row.strongestAlignedDomain?.name ?? null,
    strongestOpposedTopic: row.strongestOpposedDomain?.name ?? null,
  });
  // The spectrum reads the relationship's own confidence and its own earned
  // badge — it never re-derives either, so the two models cannot disagree.
  return {
    row,
    rel,
    spot: place({
      alignmentPct: rel.alignmentPct,
      confidence: rel.confidence,
      earned: rel.earnedLabel,
    }),
  };
};

export function NetworkPanel({
  wallet,
  selectedPerson,
  onSelectPerson,
  onCount,
  onOpenDna,
  onExplore,
}: {
  wallet?: string;
  selectedPerson?: string;
  onSelectPerson: (wallet: string) => void;
  /** Reports the list size so the parent tab can show one count. */
  onCount?: (n: number) => void;
  /** Opens the full Conviction DNA view — reached from the quiet DNA line. */
  onOpenDna?: () => void;
  onExplore?: () => void;
}) {
  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");

  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => setQuery(rawQuery.trim()), 200);
    return () => {
      if (t.current) clearTimeout(t.current);
    };
  }, [rawQuery]);

  const { data, isLoading } = useQuery(networkQO(wallet, query));

  /**
   * Everyone with any shared history, in one order. `insufficient` is the only
   * exclusion, and it means zero overlap — there is no relationship to place.
   */
  const list = useMemo(
    () =>
      (data?.people ?? [])
        .map(present)
        .filter((v) => v.rel.group !== "insufficient")
        .sort((a, b) =>
          compareSpectrum(
            { ...a.spot, sharedConvictions: a.rel.sharedConvictions, wallet: a.row.wallet },
            { ...b.spot, sharedConvictions: b.rel.sharedConvictions, wallet: b.row.wallet },
          ),
        ),
    [data],
  );

  const searching = query.length > 0;

  /**
   * How long the list is when nothing is filtering it. Measured only on the
   * unfiltered view, or typing would shrink the list under the box and take the
   * box away mid-search.
   */
  const fullSize = useRef(0);
  if (!searching && !isLoading) fullSize.current = list.length;
  const showSearch = needsSearch(fullSize.current);

  useEffect(() => {
    if (!searching) onCount?.(list.length);
  }, [list.length, searching, onCount]);

  // The ONE line about your own DNA: how much of it exists, and a way in. No
  // stage word, no second clause, no meter — the list below is already the
  // honest picture of how well-formed this is.
  const mapped = data?.summary?.expressedBeliefs ?? 0;

  if (!wallet) {
    return (
      <div className="pt-4">
        <div className="pb-3 text-[13px] text-[var(--text-muted)]">
          Connect your wallet to find the people who stand with you.
        </div>
        <WalletConnectButton />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {mapped > 0 && (
        <button
          type="button"
          onClick={onOpenDna}
          disabled={!onOpenDna}
          className="mb-3 self-start rounded-[6px] px-1 py-0.5 text-[11px] text-[var(--text-muted)] transition-colors enabled:hover:text-[var(--text-secondary)] disabled:cursor-default"
          aria-label="Open your Conviction DNA"
        >
          <span className="num">{mapped}</span> convictions mapped
          {onOpenDna && <span aria-hidden> ›</span>}
        </button>
      )}

      {showSearch && (
        <input
          value={rawQuery}
          onChange={(e) => setRawQuery(e.target.value)}
          placeholder="Search people…"
          aria-label="Search people"
          className="mb-2.5 w-full rounded-md bg-[var(--surface)] px-2.5 py-1.5 text-[13px] outline-none"
          style={{ border: "1px solid var(--border)" }}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && list.length === 0 ? (
          <ul className="space-y-1.5" aria-hidden>
            {Array.from({ length: 8 }).map((_, i) => (
              <li key={i} className="h-14 animate-pulse rounded-[10px] bg-[var(--border)]/40" />
            ))}
          </ul>
        ) : list.length === 0 ? (
          searching ? (
            <p className="pt-3 text-[12.5px] text-[var(--text-muted)]">
              No people match this search.
            </p>
          ) : (
            <EmptyPeople onExplore={onExplore} />
          )
        ) : (
          <ul className="flex flex-col gap-0.5">
            {list.map((v) => (
              <PersonRow
                key={v.row.wallet}
                v={v}
                selected={selectedPerson?.toLowerCase() === v.row.wallet.toLowerCase()}
                onSelect={() => onSelectPerson(v.row.wallet)}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * One person, three answers, in the order they are asked:
 *
 *   WHO IS THIS?        the name
 *   HOW SIMILAR ARE WE? the match, and the word for it when there is one
 *   WHY SHOULD I CARE?  the shared convictions behind the match
 *
 * The percentage NEVER stands alone — its evidence is on the same line, so
 * "100% match · 2 shared" reads as the thin thing it is rather than as a claim.
 * The colour carries the rest: damped by confidence, so a barely-known person is
 * grey however extreme their raw number.
 */
function PersonRow({
  v,
  selected,
  onSelect,
}: {
  v: PersonView;
  selected: boolean;
  onSelect: () => void;
}) {
  const { row, rel, spot } = v;
  const word = bandLabel(spot.band);
  const tone = spectrumColor(spot.position);
  const shared = rel.sharedConvictions;
  const sharedText = `${shared} shared conviction${shared === 1 ? "" : "s"}`;

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        aria-label={`${row.displayName}${word ? `, ${word}` : ""}. ${spot.matchPct}% match, ${sharedText}.`}
        className="flex w-full items-center gap-3 rounded-[10px] px-2 py-2.5 text-left transition-colors hover:bg-[var(--surface)]"
        style={selected ? { background: "var(--surface)" } : undefined}
      >
        {row.avatarUrl ? (
          <img src={row.avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
        ) : (
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white"
            style={{ background: `hsl(${hueFor(row.wallet)} 45% 45%)` }}
            aria-hidden
          >
            {initialsFor(row.displayName)}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-[var(--text)]">
            {row.displayName}
          </span>
          <span className="mt-1 flex items-baseline gap-1.5 text-[11.5px]">
            <span className="num shrink-0 font-semibold" style={{ color: tone }}>
              {spot.matchPct}% match
            </span>
            {word && (
              <span className="shrink-0 font-medium" style={{ color: tone }}>
                · {word}
              </span>
            )}
            <span className="num truncate text-[var(--text-muted)]">· {sharedText}</span>
          </span>
        </span>
      </button>
    </li>
  );
}

function EmptyPeople({ onExplore }: { onExplore?: () => void }) {
  return (
    <div className="pt-2">
      <div className="text-[14px] font-semibold text-[var(--text)]">No one yet.</div>
      <p className="mt-2 text-[12.5px] leading-relaxed text-[var(--text-muted)]">
        Take a side, and the people who stand with you — and against you — appear here.
      </p>
      {onExplore && (
        <button
          type="button"
          onClick={onExplore}
          className="mt-4 rounded-[10px] px-3.5 py-2 text-[12px] font-semibold text-[var(--bg)] transition-transform active:scale-[0.98] motion-reduce:active:scale-100"
          style={{ background: "var(--text)" }}
        >
          Explore markets
        </button>
      )}
    </div>
  );
}
