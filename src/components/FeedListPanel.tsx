/**
 * THE PLAYLIST — navigation for the centre stage, not a second feed.
 *
 * This panel answers exactly two questions and refuses the rest:
 *
 *   WHERE AM I?      the market being read is pinned at the top, labelled
 *                    "Now Reading", and never scrolls out of reach.
 *   WHAT IS NEXT?    the remaining markets, in the order they will arrive.
 *
 * WHAT WAS REMOVED, AND WHY. "Up next (25)", the queue size and the "1 new
 * market" notice were all implementation details wearing UI: no reader decides
 * anything differently because the queue holds 25 rather than 24. A playlist
 * does not tell you how long it is; it tells you what is playing and what
 * follows. New markets are folded in silently as the reader advances, so
 * freshness costs nothing and interrupts nothing.
 *
 * The rows stay quiet on purpose — a question, one reason, a couple of facts.
 * The centre panel is where a market gets its space, and this column must never
 * compete with it.
 */
import { useEffect, useRef } from "react";
import { composeDiscoveryRow } from "@/domain/market-discovery";
import type { FeedFilters, FeedNetwork } from "@/domain/feed/filters";
import type { MarketRow } from "@/components/MarketCard";
import { marketTitle, marketTitleFallback } from "@/domain/market-title";
import { WhyThis } from "@/components/WhyThis";
import { participantCount } from "@/domain/participants";
import { lensHero, scaleLine, type Lens } from "@/domain/feed/lens";
import { ExploreSelector } from "@/components/ExploreSelector";

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** One entry in the running order, as the panel needs it. */
export interface FeedListEntry {
  onchainId: number;
  /** The sentence from `reasonFor`. Null when nothing true could be said. */
  reason: string | null;
}

/**
 * Row facts, from the SAME composer a search result uses, so a market found by
 * searching and the same market waiting in the playlist say the same things
 * about themselves in the same words.
 */
function factsOf(row: MarketRow | undefined, nowMs: number) {
  if (!row) return null;
  const r = row as unknown as Record<string, unknown>;
  const capitalUsd = num(r.yes_capital_usd) + num(r.no_capital_usd);
  // THE TWO UNIVERSAL MEASURES OF SCALE. Every market gets them under every
  // lens: they are how a reader tells a real question from an empty one, and no
  // lens replaces them. Both come off the row the feed already shipped — no
  // second query, no second cache, no second definition.
  //
  // Participants is the CANONICAL count (@/domain/participants) — the same
  // number the server ranks "Most Participants" on and the same one a search
  // result prints. Ranking on one figure and displaying another is the exact
  // failure this shares a definition to avoid.
  const participants = participantCount({
    reachParticipants: num(r.participants),
    believersYes: num(row.believers_yes),
    believersNo: num(row.believers_no),
  });
  const createdAt = Date.parse(String(r.market_created_at ?? ""));
  const ageHours = Number.isFinite(createdAt) ? Math.max(0, (nowMs - createdAt) / 3_600_000) : null;
  return {
    scale: { participants, capitalUsd },
    ageHours,
    // A ROW WITHOUT A TITLE HAS NO QUESTION — it must NOT manufacture one.
    // Resolving the placeholder here made `?? activeTitle` unreachable, so the
    // pinned card printed "Market #2618" while the centre panel, holding the
    // same market's full row, showed the question. Absence stays absent; the
    // caller decides what to fall back to.
    question: marketTitle(row.markets?.title, row.onchain_id),
    hasTitle: Boolean(row.markets?.title?.trim()),
    discovery: composeDiscoveryRow({
      participants: num(r.participants),
      believers: num(row.believers_yes) + num(row.believers_no),
      capitalUsd,
      firstActivityAt: (r.first_activity_at as number | null) ?? null,
      lastActivityAt: (r.last_activity_at as number | null) ?? null,
      joined24h: num(r.new_believers_24h),
      nowMs,
    }),
  };
}

export function FeedListPanel({
  entries,
  rows,
  activeId,
  onSelect,
  lens,
  onLens,
  lensExhausted = false,
  loading = false,
  failed = false,
  filters,
  onFilters,
  availableNetworks,
}: {
  /** The visible running order, already sequenced by the server. */
  entries: FeedListEntry[];
  /** Read-model rows keyed by onchain id — the same map the centre panel uses. */
  rows: Record<number, MarketRow>;
  activeId: number | null;

  onSelect: (id: number) => void;
  /** Which question the reader asked — see @/domain/feed/lens. */
  lens: Lens;
  onLens: (l: Lens) => void;
  /**
   * The chosen lens has genuinely run out — not loading, not a short batch, not
   * a failed request. Computed in the route, where the query's own state is;
   * this panel renders the verdict and never infers one from `entries.length`.
   */
  lensExhausted?: boolean;
  /**
   * No feed for THIS lens has arrived yet.
   *
   * Distinct from "empty", and the distinction is the whole reason the column
   * stops jumping: an unanswered request and a genuinely empty result look
   * identical from `entries.length`, and rendering the empty-state sentence for
   * the first collapsed the list to one line and expanded it again a moment
   * later. Loading gets the shape; only a real answer gets the words.
   */
  loading?: boolean;
  /**
   * The feed could not be loaded — failed, or never settled.
   *
   * A THIRD state, and it needs its own words. Without it this panel fell
   * through to "Nothing matches this feed yet. Try widening it", which blames
   * the reader's filter for a network failure and sends them to change a control
   * that was never the problem.
   */
  failed?: boolean;
  filters: FeedFilters;
  onFilters: (f: FeedFilters) => void;
  /** Network groups this viewer's evidence can fill. Always includes everyone. */
  availableNetworks: FeedNetwork[];
}) {
  const rowRefs = useRef(new Map<number, HTMLLIElement>());
  const nowMs = Date.now();

  // Advancing in the centre panel moves the highlight, which may be off-screen
  // here. `nearest` reveals it without recentring a list the reader is scrolling.
  useEffect(() => {
    if (activeId == null) return;
    rowRefs.current.get(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const upcoming = entries.filter((e) => e.onchainId !== activeId);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ExploreSelector
        lens={lens}
        onLens={onLens}
        filters={filters}
        onFilters={onFilters}
        availableNetworks={availableNetworks}
      />

      {loading && upcoming.length === 0 ? (
        <PlaylistSkeleton />
      ) : failed && upcoming.length === 0 ? (
        <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
          Couldn&rsquo;t load markets. Retry from the centre.
        </p>
      ) : upcoming.length === 0 && !lensExhausted ? (
        <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
          {/* An empty result under a filter is a TRUE answer, and saying it
              plainly beats a loading state that will never resolve. */}
          {entries.length === 0
            ? "Nothing matches this feed yet. Try widening it."
            : "You're at the end of this feed."}
        </p>
      ) : (
        <ol className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {upcoming.map((e) => {
            const f = factsOf(rows[e.onchainId], nowMs);
            /**
             * THREE LINES, IN ONE HIERARCHY: the question, why it is here, and
             * the scale of the market.
             *
             * WHY IT IS HERE depends on the lens, and on one rule. Most Capital,
             * Most Believers and Fresh rank on a WHOLE-MARKET total, so their
             * hero is that total and it never names a side — turning "Most
             * Capital" into "YES has $505" would describe a side while ranking
             * on the sum. For You and Moving rank on something that genuinely is
             * about a side, so their hero is the sentence the canonical engines
             * already wrote ("Your Tribe is backing YES", "YES moved up 8.4%
             * today") and it may say so.
             */
            const hero = f ? lensHero(lens, f.scale, f.ageHours) : null;
            // Only the reason-led lenses fall back to the market's own story: a
            // ranked lens with no hero has nothing to claim, and the discovery
            // sentence would be answering a question the reader did not ask.
            const line = hero ? null : (e.reason ?? f?.discovery.story ?? null);
            // The quiet grounding, minus whatever the hero just said out loud.
            const scale = f ? scaleLine(lens, f.scale) : null;
            return (
              <li
                key={e.onchainId}
                ref={(el) => {
                  if (el) rowRefs.current.set(e.onchainId, el);
                  else rowRefs.current.delete(e.onchainId);
                }}
              >
                <button
                  type="button"
                  onClick={() => onSelect(e.onchainId)}
                  className="w-full rounded-[10px] px-3 py-2 text-left transition-colors hover:bg-[var(--surface)]"
                >
                  <span className="block text-[13px] font-medium leading-snug text-[var(--text-secondary)]">
                    {f?.question ?? marketTitleFallback(e.onchainId)}
                  </span>
                  {/* The hero of a ranked lens is a FACT ABOUT THE MARKET, so it
                    is not painted in the discovery purple — that accent means
                    "this one is about you" everywhere else in the product, and
                    "$505 committed" is not. It takes the text weight instead. */}
                  {hero && (
                    <span className="num mt-0.5 block text-[12px] font-semibold text-[var(--text)]">
                      {hero}
                    </span>
                  )}
                  <WhyThis reason={line} className="mt-0.5 whitespace-normal" />
                  {/* Believers and capital ground every market under every lens.
                    The quietest line on the row, and never a repeat of the hero. */}
                  {scale && (
                    <span className="num mt-0.5 block text-[11px] text-[var(--text-muted)]">
                      {scale}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {/* THE LAST ITEM IN THE PLAYLIST, not a modal, a banner or a takeover.
            The reader chose this lens and finished it; the market they are on
            stays in the centre and this is simply what follows the final row. */}
          {lensExhausted && <Continuation onContinue={() => onLens("for_you")} />}
        </ol>
      )}
    </div>
  );
}

/**
 * THE END OF A CHOSEN LENS.
 *
 * The alternative was to quietly serve For You markets once a finite lens ran
 * dry, which is the one thing this must not do: the control would still read
 * "Fresh" while the playlist had stopped being fresh markets, and nothing on
 * screen would ever say so. Reaching the end of something you picked is worth
 * one line; being moved somewhere else without being told is not.
 *
 * ONE MOVE, and it is the same `onLens` every chip calls — so the lens row
 * updates, the playlist restarts through the canonical path, and the label can
 * never disagree with the ranking behind it. There is no second button, no
 * countdown and no automatic navigation.
 */
function Continuation({ onContinue }: { onContinue: () => void }) {
  return (
    <li className="px-3 pb-1 pt-4">
      <p className="text-[12px] leading-snug text-[var(--text-muted)]">You&rsquo;re caught up.</p>
      <button
        type="button"
        onClick={onContinue}
        className="mt-1 text-[12px] font-semibold transition-opacity hover:opacity-80"
        style={{ color: "var(--rel,#9b87f5)" }}
      >
        Continue with Up Next <span aria-hidden>&rarr;</span>
      </button>
    </li>
  );
}

/**
 * THE SHAPE OF A PLAYLIST, BEFORE THERE IS ONE.
 *
 * Switching lens used to collapse this column to a single line of text and then
 * push it back open a few hundred milliseconds later — the list, the heading and
 * everything under them moving twice for one decision. That is not a slow feed,
 * it is an interface that forgot how much room it was using.
 *
 * So the skeleton is the ROW, not a spinner: the same paddings, the same three
 * bands, the same rhythm, at the same heights. The column is the size it will be
 * when the answer lands, so the answer costs nothing to arrive.
 *
 * THE LINE COUNTS ARE FIXED AND UNEVEN ON PURPOSE. Real questions wrap to one,
 * two or three lines, so a uniform skeleton would itself be a jump the moment
 * real text replaced it. This pattern repeats, which keeps the total height
 * deterministic — a random one would make the reserved space differ between the
 * server render and the client's, which is the same bug wearing a costume.
 *
 * `aria-hidden` and no text: a screen reader should hear the answer, not the
 * placeholder. `animate-pulse` is the one motion, and `motion-reduce` stops it.
 */
const SKELETON_LINES = [2, 1, 2, 3, 1, 2, 2, 1] as const;

function PlaylistSkeleton() {
  return (
    <ul className="min-h-0 flex-1 space-y-0.5 overflow-hidden" aria-hidden>
      {SKELETON_LINES.map((lines, i) => (
        <li key={i} className="px-3 py-2">
          {/* The question — one bar per line it would have taken, the last one
            short, exactly as a wrapped sentence ends. */}
          {Array.from({ length: lines }).map((_, l) => (
            <div
              key={l}
              className="mb-1 h-[13px] animate-pulse rounded bg-[var(--border)]/40 motion-reduce:animate-none"
              style={{ width: l === lines - 1 ? "62%" : "100%" }}
            />
          ))}
          {/* The hero, then the quiet scale line — the same two rows every real
            row carries, at the same sizes. */}
          <div className="mt-1.5 h-[12px] w-[38%] animate-pulse rounded bg-[var(--border)]/40 motion-reduce:animate-none" />
          <div className="mt-1.5 h-[11px] w-[52%] animate-pulse rounded bg-[var(--border)]/25 motion-reduce:animate-none" />
        </li>
      ))}
    </ul>
  );
}
