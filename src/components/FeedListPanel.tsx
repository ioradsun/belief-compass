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
  return {
    question: marketTitle(row.markets?.title, row.onchain_id),
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

function Metrics({ metrics }: { metrics: { label: string; value: string }[] }) {
  if (metrics.length === 0) return null;
  return (
    <span className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
      {metrics.map((m, i) => (
        <span key={m.label} className="flex items-center gap-1.5">
          {i > 0 && <span aria-hidden>·</span>}
          <span className="tabular-nums">{m.value}</span>
          <span className="opacity-80">{m.label}</span>
        </span>
      ))}
    </span>
  );
}

export function FeedListPanel({
  entries,
  rows,
  activeId,
  onSelect,
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

  const active = activeId == null ? null : (entries.find((e) => e.onchainId === activeId) ?? null);
  const upcoming = entries.filter((e) => e.onchainId !== activeId);
  const activeFacts = activeId == null ? null : factsOf(rows[activeId], nowMs);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2">
        <FeedFilterMenu
          filters={filters}
          onChange={onFilters}
          availableNetworks={availableNetworks}
          sensitivity={sensitivity}
          onSensitivity={onSensitivity}
        />
      </div>

      {/* NOW READING — pinned, always visible, unmistakably the current one. */}
      {activeId != null && (
        <div
          className="mb-3 rounded-[12px] px-3 py-2.5"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border-strong)",
          }}
          aria-current="true"
        >
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text-muted)]">
            Now reading
          </p>
          <p className="text-[13px] font-semibold leading-snug text-[var(--text)]">
            {activeFacts?.question ?? marketTitleFallback(activeId)}
          </p>
          {(active?.reason ?? activeFacts?.discovery.story) && (
            <p className="mt-1 text-[12px] leading-snug text-[var(--text-muted)]">
              {active?.reason ?? activeFacts?.discovery.story}
            </p>
          )}
          <Metrics metrics={activeFacts?.discovery.metrics ?? []} />
        </div>
      )}

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
            // The reason the feed picked this market outranks the market's own
            // momentum sentence: one is about the reader, the other about the
            // market. Only when there is no reason does the story stand in.
            const line = e.reason ?? f?.discovery.story ?? null;
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
                  {line && (
                    <span className="mt-0.5 block text-[12px] leading-snug text-[var(--text-muted)]">
                      {line}
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
