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
import { FeedFilterMenu } from "@/components/FeedFilterMenu";
import type { FeedFilters, FeedNetwork } from "@/domain/feed/filters";
import type { MarketRow } from "@/components/MarketCard";
import type { Sensitivity } from "@/domain/market-change";
import { marketTitle, marketTitleFallback } from "@/domain/market-title";
import { WhyThis } from "@/components/WhyThis";
import { LENSES, LENS_LABELS, lensHero, scaleLine, type Lens } from "@/domain/feed/lens";

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
  const believers = num(row.believers_yes) + num(row.believers_no);
  const createdAt = Date.parse(String(r.market_created_at ?? ""));
  const ageHours = Number.isFinite(createdAt) ? Math.max(0, (nowMs - createdAt) / 3_600_000) : null;
  return {
    scale: { believers, capitalUsd },
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

/**
 * THE LENS ROW — the one control, and the only thing above the running order.
 *
 * Text, not chips: five words in a row that scrolls, in the same weight the rest
 * of this column uses. A pill per lens would put five filled shapes at the top of
 * a 320px rail and make choosing a lens look heavier than reading the list it
 * chooses. The selected one is `--rel`, the accent this product already uses for
 * "this one is about you".
 */
function LensRow({ value, onChange }: { value: Lens; onChange: (l: Lens) => void }) {
  return (
    <div
      role="tablist"
      aria-label="Explore by"
      // A fixed height, so switching lenses cannot change the row's own size and
      // move the list underneath it.
      className="mb-2 flex h-[26px] shrink-0 items-center gap-3 overflow-x-auto"
    >
      {LENSES.map((l) => {
        const on = l === value;
        return (
          <button
            key={l}
            role="tab"
            aria-selected={on}
            type="button"
            onClick={() => onChange(l)}
            className={`shrink-0 whitespace-nowrap text-[12px] transition-colors ${
              on ? "font-semibold" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            }`}
            style={on ? { color: "var(--rel,#9b87f5)" } : undefined}
          >
            {LENS_LABELS[l]}
          </button>
        );
      })}
    </div>
  );
}

export function FeedListPanel({
  entries,
  rows,
  activeId,
  onSelect,
  lens,
  onLens,
  filters,
  onFilters,
  availableNetworks,
  sensitivity,
  onSensitivity,
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
  filters: FeedFilters;
  onFilters: (f: FeedFilters) => void;
  /** Network groups this viewer's evidence can fill. Always includes everyone. */
  availableNetworks: FeedNetwork[];
  sensitivity?: Sensitivity;
  onSensitivity?: (s: Sensitivity) => void;
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
      <LensRow value={lens} onChange={onLens} />

      <div className="mb-2">
        <FeedFilterMenu
          filters={filters}
          onChange={onFilters}
          availableNetworks={availableNetworks}
          sensitivity={sensitivity}
          onSensitivity={onSensitivity}
        />
      </div>

      {upcoming.length === 0 ? (
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
        </ol>
      )}
    </div>
  );
}
