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
import { composeMarketRow } from "@/domain/market-row";
import { formatMoneyCompact } from "@/domain/money";
import { useMoney } from "@/lib/display-unit";
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
 * Row facts, derived from the read-model row the feed already sent.
 *
 * Participants counts everyone with a position, mixed included: the question is
 * "how many people are in this", and someone holding both sides is still in it.
 * Size is the capital actually committed to the two sides — not volume, which
 * counts the same money each time it moves.
 */
function factsOf(row: MarketRow | undefined) {
  if (!row) return null;
  const participants = num(row.believers_yes) + num(row.believers_no) + num(row.believers_mixed);
  const yes = row.yes_capital_usd == null ? null : num(row.yes_capital_usd);
  const no = row.no_capital_usd == null ? null : num(row.no_capital_usd);
  const capitalUsd = yes == null && no == null ? null : num(yes) + num(no);
  return {
    question: row.markets?.title ?? `Market #${row.onchain_id}`,
    participants,
    capitalUsd,
    state: composeMarketRow({ yesPct: row.people_yes_pct, believers: participants }),
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
  const { unit, ethUsd } = useMoney();
  const listRef = useRef<HTMLOListElement | null>(null);
  const rowRefs = useRef(new Map<number, HTMLLIElement>());

  // Advancing in the centre panel moves the active row, which may be off-screen
  // here. `nearest` reveals it without recentring a list the reader is scrolling.
  useEffect(() => {
    if (activeId == null) return;
    rowRefs.current.get(activeId)?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const money = (usd: number | null) =>
    usd == null || usd <= 0
      ? null
      : formatMoneyCompact(usd, { from: "USD", to: unit, ethUsd: ethUsd ?? 0 });

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
            const f = factsOf(rows[e.onchainId]);
            const active = e.onchainId === activeId;
            const size = money(f?.capitalUsd ?? null);
            const people =
              f && f.participants > 0
                ? `${f.participants} participant${f.participants === 1 ? "" : "s"}`
                : null;
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

                  {e.reason && (
                    <span className="mt-1 block text-[12px] leading-snug text-[var(--text-muted)]">
                      {e.reason}
                    </span>
                  )}

                  {(people || size || f?.state.stateText) && (
                    <span className="mt-1.5 flex items-center gap-1.5 text-[11px] tabular-nums text-[var(--text-muted)]">
                      {f?.state.stateText && (
                        <span
                          style={{
                            color:
                              f.state.leadSide === "YES"
                                ? "var(--yes, #10b981)"
                                : "var(--no, #f43f5e)",
                          }}
                        >
                          {f.state.stateText}
                        </span>
                      )}
                      {f?.state.stateText && (people || size) && <span aria-hidden>·</span>}
                      {people}
                      {people && size && <span aria-hidden>·</span>}
                      {size}
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
