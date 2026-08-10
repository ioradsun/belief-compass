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
 * THERE IS NO SEARCH BOX, and removing it is what made the ONE control visible.
 * The box and the spectrum filter shared a `needsSearch(...)` gate, so under
 * twenty people neither appeared: a reader with eight people had no way to look
 * at just their Tribe, and a reader with thirty got two controls at once. The
 * box also duplicated a search that already exists — the header field queries
 * people across the whole platform, through the same `getNetwork(query)` this
 * panel was calling. So the filter is now simply always there, on its own, and
 * the answer to "where do I search for a person" is the one field in the header.
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
import { DotFilter } from "@/components/DotFilter";
import { presentRelationship, type RelationshipPresentation } from "@/domain/relationship";
import { getDependability } from "@/lib/challenge.functions";
import { bondFor, EMPTY_TALLY, type Bond, type Tally } from "@/domain/dependability";
import {
  place,
  bandLabel,
  compareSpectrum,
  spectrumColor,
  spectrumRing,
  matchesFilter,
  SPECTRUM_FILTERS,
  type SpectrumFilter,
  type SpectrumPlace,
} from "@/domain/relationship-spectrum";

interface PersonView {
  row: NetworkPersonRow;
  rel: RelationshipPresentation;
  /** Whether they show up for you. Undefined until the batch read lands. */
  bond?: Bond;
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
  // The spectrum reads the relationship's own group and confidence
  // — it re-derives NOTHING, so the word on the row and the word the engine chose
  // cannot disagree. It contributes the ordering and the colour, only.
  return {
    row,
    rel,
    spot: place({
      alignmentPct: rel.alignmentPct,
      confidence: rel.confidence,
      group: rel.group,
    }),
  };
};

export function NetworkPanel({
  wallet,
  selectedPerson,
  onSelectPerson,
  onCount,
  onExplore,
}: {
  wallet?: string;
  selectedPerson?: string;
  onSelectPerson: (wallet: string) => void;
  /** Reports the list size so the parent tab can show one count. */
  onCount?: (n: number) => void;
  onExplore?: () => void;
}) {
  const [filter, setFilter] = useState<SpectrumFilter>("all");

  // The UNFILTERED network, always. `networkQO` still takes a query — the header
  // search uses it — but this panel no longer asks the server to narrow the list,
  // so it reads the same cache entry every other surface does.
  const { data, isLoading } = useQuery(networkQO(wallet));

  /**
   * Everyone with any shared history, in one order. `insufficient` is the only
   * exclusion, and it means zero overlap — there is no relationship to place.
   */
  const everyone = useMemo(
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

  /**
   * DO THEY SHOW UP FOR YOU — one batch read for the whole rail.
   *
   * A SEPARATE QUERY, NOT A WIDER `getNetwork`. `networkQO` is one cache entry
   * read by several surfaces, so adding a field there would change all of them
   * and invalidate a cache the feed depends on. This joins client-side instead,
   * which also means the cards paint immediately from the network read and the
   * sentence arrives a beat later rather than holding the list back.
   */
  const wallets = useMemo(() => everyone.map((v) => v.row.wallet), [everyone]);
  const { data: bonds } = useQuery({
    queryKey: ["dependability", wallet ?? null, wallets.length],
    queryFn: () => getDependability({ data: { viewer: wallet ?? null, wallets } }),
    enabled: !!wallet && wallets.length > 0,
    staleTime: 60_000,
  });

  const list = useMemo(
    () =>
      everyone
        .filter((v) => matchesFilter(v.spot.band, filter))
        .map((v) => {
          const pair = bonds?.[v.row.wallet.toLowerCase()];
          return {
            ...v,
            // No call history is a real state and the most common one — `bondFor`
            // answers it with silence rather than a zero.
            bond: bondFor(
              v.row.displayName,
              (pair?.theirs ?? EMPTY_TALLY) as Tally,
              (pair?.yours ?? EMPTY_TALLY) as Tally,
            ),
          };
        }),
    [everyone, filter, bonds],
  );

  // The tab's count is the whole network, never what the filter left behind:
  // looking at just your Tribe must not make the number of people you have
  // appear to drop.
  useEffect(() => {
    onCount?.(everyone.length);
  }, [everyone.length, onCount]);

  // The ONE line about your own DNA: how much of it exists. No page to open, no
  // stage word, no meter — just the honest count and why it is worth growing.
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
        <p className="mb-3 text-[11px] leading-snug text-[var(--text-muted)]">
          Every conviction helps find your people.
        </p>
      )}

      {/* THE ONE CONTROL. It used to share a visibility gate with the search box
        and so appeared only past twenty people — which meant the reader most
        likely to want "just my Tribe" (a short, new list) was the one who could
        not have it. It stands alone now, and it is always there. */}
      <div className="mb-2.5 flex items-center justify-end">
        <SpectrumFilterControl value={filter} onChange={setFilter} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && list.length === 0 ? (
          <ul className="space-y-1.5" aria-hidden>
            {Array.from({ length: 8 }).map((_, i) => (
              <li key={i} className="h-14 animate-pulse rounded-[10px] bg-[var(--border)]/40" />
            ))}
          </ul>
        ) : list.length === 0 ? (
          filter !== "all" ? (
            <p className="pt-3 text-[12.5px] text-[var(--text-muted)]">No people here yet.</p>
          ) : (
            <EmptyPeople onExplore={onExplore} />
          )
        ) : (
          <ul className="flex flex-col gap-0.5">
            {list.map((v) => (
              <PersonCard
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
 * WHICH REGION OF THE CONTINUUM TO LOOK AT.
 *
 * THE CONTROL ITSELF MOVED to `components/DotFilter`, unchanged, because the
 * Insider column needed the same one and a second copy would have drifted — a
 * different close behaviour here, a missing aria role there. What is left is the
 * only part that was ever about people: the vocabulary.
 */
function SpectrumFilterControl({
  value,
  onChange,
}: {
  value: SpectrumFilter;
  onChange: (f: SpectrumFilter) => void;
}) {
  return (
    <DotFilter
      value={value}
      onChange={onChange}
      ariaLabel="Filter people"
      options={SPECTRUM_FILTERS.map((f) => ({ id: f.id, label: f.label, dot: FILTER_DOT[f.id] }))}
    />
  );
}

/** The menu's dots are the continuum itself: deep blue → neutral → deep amber. */
const FILTER_DOT: Record<SpectrumFilter, string> = {
  all: "linear-gradient(90deg, var(--yes), var(--text-muted), var(--no))",
  tribe: spectrumColor(0.4),
  rival: spectrumColor(-0.4),
  neutral: "var(--text-muted)",
};

/**
 * A PERSON IS A POSITION.
 *
 * The anatomy is `ConvictionCard`'s, one for one, because the Positions rail
 * already solved this exact layout problem in this exact width and the two rails
 * should read as one system:
 *
 *   the question      → the person
 *   what changed      → what this relationship is right now
 *   value / return    → how much you agree
 *   "you also back NO"→ nothing; the sentence already carried it
 *
 * THE SENTENCE IS THE HERO. "You show up for each other" is the payoff of the
 * entire Challenge system — it is where the software stops describing people and
 * starts describing a relationship — so it gets the weight, and the number below
 * merely explains why. A dashboard of two percentages says the same thing and
 * says it coldly.
 *
 * ONE NUMBER, NOT TWO. The showing-up truth is already in the sentence; printing
 * "76% Dependable" beside it states the same fact twice and in the worse of the
 * two languages. The count that backs it lives one level down, on the profile.
 *
 * QUIET BEATS MANUFACTURED. No history renders no sentence — not "no calls yet",
 * not a zero. Most relationships on this platform have no call history and saying
 * so on every card would be noise with a false note in it.
 */
function PersonCard({
  v,
  selected,
  onSelect,
}: {
  v: PersonView;
  selected: boolean;
  onSelect: () => void;
}) {
  const { row, rel, spot, bond } = v;
  /**
   * NO WORD IS A STATE, NOT A MISSING VALUE.
   *
   * This read `?? "Neutral"`, which put the literal word NEUTRAL in the corner of
   * every card the model could not place — re-introducing the exact word
   * `bandLabel` returns null to avoid. It was survivable while placement was
   * loose. It is not now: with Conviction Match driving placement, most people a
   * reader knows have no label, and a rail of NEUTRAL badges reads as broken
   * rather than as honest.
   *
   * So the slot is simply absent, and the card still says everything true about
   * the relationship — the percentage and the count it comes from.
   */
  const word = bandLabel(spot.band);
  const tone = spectrumColor(spot.position);
  const ring = spectrumRing(spot.position);
  const [imgFailed, setImgFailed] = useState(false);
  const showImg = Boolean(row.avatarUrl) && !imgFailed;
  // CONVICTION MATCH — null when there is nothing to divide, and null renders
  // nothing. A person you have met once has no percentage, not a 0%.
  const match = rel.matchPct;

  return (
    <li>
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect();
          }
        }}
        aria-current={selected ? "true" : undefined}
        aria-label={[
          row.displayName,
          word,
          match != null
            ? `${match} percent Conviction Match, ${rel.together} of ${rel.sharedConvictions} together`
            : null,
          bond?.sentence,
        ]
          .filter(Boolean)
          .join(". ")}
        className="block w-full cursor-pointer rounded-[14px] p-3.5 text-left transition-colors hover:bg-[var(--surface-2)]"
        style={{ background: selected ? "var(--surface-2)" : "var(--surface)" }}
      >
        {/* 1 — Who. The ring keeps carrying the continuum; the word names it. */}
        <div className="flex items-center gap-2.5">
          <span
            className="grid shrink-0 place-items-center rounded-full"
            style={{ padding: ring.width, background: ring.color }}
            aria-hidden
          >
            {showImg ? (
              <img
                src={row.avatarUrl!}
                alt=""
                onError={() => setImgFailed(true)}
                className="h-8 w-8 rounded-full object-cover"
                style={{ outline: "2px solid var(--bg)", outlineOffset: -1 }}
              />
            ) : (
              <span
                className="grid h-8 w-8 place-items-center rounded-full text-[10px] font-semibold text-white"
                style={{ background: `hsl(${hueFor(row.wallet)} 45% 45%)` }}
              >
                {initialsFor(row.displayName)}
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[var(--text)]">
            {row.displayName}
          </span>
          {word && (
            <span
              className="shrink-0 text-[10px] font-semibold uppercase tracking-wide"
              style={{ color: tone }}
            >
              {word}
            </span>
          )}
        </div>

        {/* 2 — The story. Absent, never zeroed. */}
        {bond?.sentence && (
          <p className="mt-2 text-[12.5px] leading-snug text-[var(--text)]">{bond.sentence}</p>
        )}

        {/* 3 — Why, and the arithmetic that proves it. The percentage IS
            together ÷ shared, so the line beneath it is not a footnote — it is
            the sum, and a reader can check it against the profile's history. */}
        {match != null && (
          <div className="mt-2.5">
            <div className="num text-[16px] font-semibold leading-none text-[var(--text)]">
              {match}%
            </div>
            <div className="mt-1 text-[10px] text-[var(--text-muted)]">Conviction Match</div>
            <div className="num mt-1 text-[10px] text-[var(--text-muted)]">
              {rel.together} of {rel.sharedConvictions} together
            </div>
          </div>
        )}
      </div>
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
