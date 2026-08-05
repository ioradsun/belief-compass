/**
 * FEED LIST — the running order, made visible.
 *
 * The server has always returned a finished sequence. The centre panel consumed
 * it one market at a time, so a reader could see what they were looking at and
 * nothing else: no sense of what came before, what is next, or how long the
 * queue is. This panel is that sequence on screen, and it is deliberately NOT a
 * grid of cards — a row here answers "should I go there next", not "what should
 * I do about this market". The centre panel is where a market gets its space.
 *
 * FOUR THINGS PER ROW, and no fifth:
 *   1. the question
 *   2. the one sentence saying why it is here
 *   3. participants and size, when known
 *   4. where the market currently stands
 *
 * The reason is the load-bearing one. `reasonFor` has been writing these
 * sentences all along and `index.tsx` has been collecting them into a map that
 * nothing read — the fifth time in this codebase something computed the right
 * answer and dropped it. A row without its reason is a list of titles, which is
 * what search already was.
 *
 * THE ORDER HOLDS STILL. Every rule about when this list may change lives in
 * `@/domain/feed-queue`; this component renders what it is given and reports
 * clicks. New markets arrive behind a notice the reader chooses to accept.
 */
import { useEffect, useRef } from "react";
import { composeDiscoveryRow } from "@/domain/market-discovery";
import type { MarketRow } from "@/components/MarketCard";

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
 * Row facts, from the SAME composer a search result uses.
 *
 * This is the point of sharing `composeDiscoveryRow` rather than writing a
 * second version here: a market found by searching and the same market waiting
 * in the running order now say the same things about themselves, in the same
 * words, from the same numbers. Two surfaces describing one market two ways is
 * how a reader learns not to trust either.
 */
function factsOf(row: MarketRow | undefined, nowMs: number) {
  if (!row) return null;
  const r = row as unknown as Record<string, unknown>;
  const capitalUsd = num(r.yes_capital_usd) + num(r.no_capital_usd);
  return {
    question: row.markets?.title ?? `Market #${row.onchain_id}`,
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
  arrivalCount,
  onSelect,
  onCommitArrivals,
}: {
  /** The visible running order, already sequenced by the server. */
  entries: FeedListEntry[];
  /** Read-model rows keyed by onchain id — the same map the centre panel uses. */
  rows: Record<number, MarketRow>;
  activeId: number | null;
  /** Markets waiting to join the order. Zero hides the notice. */
  arrivalCount: number;
  onSelect: (id: number) => void;
  onCommitArrivals: () => void;
}) {
  const listRef = useRef<HTMLOListElement | null>(null);
  const rowRefs = useRef(new Map<number, HTMLLIElement>());
  const nowMs = Date.now();

  // Advancing in the centre panel moves the active row, which may be off-screen
  // here. `nearest` reveals it without recentring a list the reader is scrolling.
  useEffect(() => {
    if (activeId == null) return;
    rowRefs.current.get(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--text-secondary)]">
          Up next
        </h2>
        {entries.length > 0 && (
          <span className="text-[11px] tabular-nums text-[var(--text-muted)]">
            {entries.length}
          </span>
        )}
      </div>

      {/* Freshness without instability: what arrived is announced, never applied
          under the reader. Accepting it is one tap, and it is always their tap. */}
      {arrivalCount > 0 && (
        <button
          type="button"
          onClick={onCommitArrivals}
          className="mb-3 w-full rounded-[10px] px-3 py-2 text-[12px] font-medium transition-colors hover:brightness-110"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            color: "var(--text)",
          }}
        >
          {arrivalCount} new market{arrivalCount === 1 ? "" : "s"}
        </button>
      )}

      {entries.length === 0 ? (
        <p className="text-[12px] leading-relaxed text-[var(--text-muted)]">
          The running order appears here once the feed loads.
        </p>
      ) : (
        <ol ref={listRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto">
          {entries.map((e) => {
            const f = factsOf(rows[e.onchainId], nowMs);
            const active = e.onchainId === activeId;
            // The reason the feed picked this market outranks the market's own
            // momentum sentence: one is about the reader, the other about the
            // market. Only when there is no reason does the story stand in.
            const line = e.reason ?? f?.discovery.story ?? null;
            const metrics = f?.discovery.metrics ?? [];
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
                  aria-current={active ? "true" : undefined}
                  className={`w-full rounded-[10px] px-3 py-2.5 text-left transition-colors ${
                    active ? "bg-[var(--surface)]" : "hover:bg-[var(--surface)]"
                  }`}
                  style={active ? { border: "1px solid var(--border)" } : undefined}
                >
                  <span
                    className={`block text-[13px] leading-snug ${
                      active
                        ? "font-semibold text-[var(--text)]"
                        : "font-medium text-[var(--text-secondary)]"
                    }`}
                  >
                    {f?.question ?? `Market #${e.onchainId}`}
                  </span>

                  {line && (
                    <span className="mt-1 block text-[12px] leading-snug text-[var(--text-muted)]">
                      {line}
                    </span>
                  )}

                  {metrics.length > 0 && (
                    <span className="mt-1.5 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                      {metrics.map((m, i) => (
                        <span key={m.label} className="flex items-center gap-1.5">
                          {i > 0 && <span aria-hidden>·</span>}
                          <span className="tabular-nums">{m.value}</span>
                          <span className="opacity-80">{m.label}</span>
                        </span>
                      ))}
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
