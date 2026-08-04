/**
 * LiveTape — the right column: the living story of conviction.
 *
 * It renders the server-grouped LiveRow DTO and owns exactly ONE decision of its
 * own: WHICH rows fit in the window. Time decides the order — a live tape that
 * re-sorts itself reads as broken, not curated, and "what just happened, in
 * order" is the whole contract it has with a reader.
 *
 * The selection runs HERE rather than on the server because delta-sync merges a
 * fresh head into the cached tail (mergeLiveRows), so the full set only exists
 * at this point. The server sends the mixer's INPUTS on each row.
 *
 * New rows animate in. That is the difference between a list that updates and a
 * feed that feels alive.
 *
 * Each row is read at a glance: a headline, one sentence, and — for group
 * stories — a stack of clickable faces, because the people are the way in.
 * Personal rows (a Twin / someone in your network) get a faint "about you"
 * highlight. Clicking a row selects that market; clicking a face opens that
 * person.
 */
import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PersonStack } from "@/components/PersonStack";
import { listLiveEvents } from "@/lib/live.functions";
import { useStickyRows } from "@/hooks/useSticky";
import { hueFor, initialsFor } from "@/lib/wallet-identity";
import { PersonAvatar } from "@/components/PersonAvatar";
import { mergeLiveRows, LIVE_DELTA_OVERLAP_MS, type LiveRow } from "@/lib/live-tape";
import { mixFeed } from "@/domain/feed-cadence";
import type { BeatTone } from "@/domain/story";

type LiveResult = { rows: LiveRow[]; error: string | null };

/** Beyond this gap since our newest cached event, a delta would be large — just
 *  do a full fetch (the persisted cache already gave the instant paint). */
const MAX_DELTA_SPAN_MS = 30 * 60_000;

/** How many rows the tape shows. The mixer picks which; time orders them. */
const VISIBLE_ROWS = 40;

function ago(iso: string): string {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function LiveTape({
  wallet,
  onSelect,
  marketIds,
  scroll = true,
  side,
  excludeMarketId,
  limit,
  showTitles = true,
  emptyText = "Nothing yet.",
  skeletonRows = 8,
}: {
  wallet?: string;
  /**
   * Select the market a row happened in. Omit inside a market's own panel —
   * a row that looks clickable and goes nowhere is worse than a plain one.
   */
  onSelect?: (marketId: number) => void;
  /** Scope the tape to one market (center deck) or a set (positions). */
  marketIds?: number[];
  /** Scope to one side of that market — the YES/NO rails. */
  side?: "YES" | "NO";
  /**
   * Own the scroll (the standalone column) or flow inline (embedded in a panel
   * that already scrolls). A scroller inside a scroller traps the gesture and
   * collapses the height, so an embedded tape must never bring its own.
   */
  scroll?: boolean;
  /** Drop this market's rows — the global feed hides what the pinned block shows. */
  excludeMarketId?: number;
  limit?: number;
  /** Hide the market title line when the tape already sits under that market. */
  showTitles?: boolean;
  emptyText?: string;
  skeletonRows?: number;
}) {
  const scopeKey = marketIds && marketIds.length > 0 ? [...marketIds].sort((a, b) => a - b) : null;
  const qc = useQueryClient();
  const key = ["live-tape", wallet ?? null, scopeKey, side ?? null, limit ?? null];
  const { data, isLoading } = useQuery({
    queryKey: key,
    queryFn: async (): Promise<LiveResult> => {
      // Delta sync (global tape only): re-fetch just the overlap window since our
      // newest cached event and merge onto the immutable tail — moving a few rows
      // instead of the whole list every 6s. Falls back to a full fetch for the
      // scoped tapes, a cold cache, or a long absence.
      const prev = qc.getQueryData<LiveResult>(key)?.rows ?? [];
      const newestMs = prev.length ? Date.parse(prev[0].occurredAt) : 0;
      const canDelta =
        scopeKey === null &&
        side == null &&
        prev.length > 0 &&
        Date.now() - newestMs <= MAX_DELTA_SPAN_MS;
      if (canDelta) {
        const sinceIso = new Date(newestMs - LIVE_DELTA_OVERLAP_MS).toISOString();
        const res = (await listLiveEvents({
          data: { wallet, limit, since: sinceIso },
        })) as LiveResult;
        if (res.error) return { rows: prev, error: res.error };
        return { rows: mergeLiveRows(prev, res.rows, sinceIso, limit ?? 120), error: null };
      }
      return (await listLiveEvents({
        data: { wallet, marketIds: scopeKey ?? undefined, side, limit },
      })) as LiveResult;
    },
    // The realtime coordinator refetches this tape the instant a trade lands
    // (events stream), so this interval is now only a slow safety reconcile for a
    // dropped socket — not the primary freshness path.
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
  // Sticky: the tape holds its rows until fresh ones arrive.
  const sticky = useStickyRows(data?.rows);
  const visible =
    excludeMarketId == null ? sticky : sticky.filter((r) => Number(r.marketId) !== excludeMarketId);

  // THE EDITORIAL PASS — and note what it does NOT do any more.
  //
  // A live tape's contract with the reader is "this is what just happened, in
  // order". Re-ordering it broke that: the column read 3h, 41m, 1h, 2h and felt
  // broken rather than curated. So the mixer now SELECTS (dominance caps, family
  // variety, significance and discovery decide which rows survive the window)
  // and time still ORDERS. Repetition is handled where feed-cadence always said
  // it belonged — in aggregation upstream, which now collapses a wallet's sweep
  // across markets into one row instead of leaving the mixer to hide fifteen.
  const rows = useMemo(() => {
    if (visible.length <= VISIBLE_ROWS || !visible.some((r) => r.mix)) return visible;
    const keep = new Set(
      mixFeed(
        visible.map(
          (r) =>
            r.mix ?? {
              id: r.id,
              family: "live_action" as const,
              significance: 0.5,
              occurredAt: r.occurredAt,
              marketId: String(r.marketId),
              side: r.side,
            },
        ),
      )
        .slice(0, VISIBLE_ROWS)
        .map((m) => m.id),
    );
    // `visible` is already newest-first, so filtering preserves live order.
    return visible.filter((r) => keep.has(r.id));
  }, [visible]);

  // ARRIVAL. A live feed should feel like it is being written, so a row that
  // was not here on the last render slides in. Tracked by id rather than by
  // index, so a poll that only re-sorts animates nothing, and the very first
  // paint animates nothing either — that would be a wall of motion, not life.
  const seen = useRef<Set<string>>(new Set());
  const painted = useRef(false);
  const isNew = (id: string) => painted.current && !seen.current.has(id);
  useEffect(() => {
    for (const r of rows) seen.current.add(r.id);
    painted.current = true;
  }, [rows]);

  return (
    <div
      className={
        scroll
          ? "h-full min-h-0 flex-1 touch-pan-y overflow-y-scroll overscroll-contain [-webkit-overflow-scrolling:touch]"
          : ""
      }
    >
      {isLoading && rows.length === 0 ? (
        <ul className="space-y-2" aria-hidden>
          {Array.from({ length: skeletonRows }).map((_, i) => (
            <li key={i} className="h-8 animate-pulse rounded bg-[var(--surface-2)]" />
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">{emptyText}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const s = r.story;
            const personal = s.personal;
            // A discovery moment is about a PERSON, not a market — it has no
            // destination of its own, and the faces are deliberately the only
            // way in. Everything else selects the market it happened in.
            const target = Number(r.marketId);
            const navigable = !!onSelect && Number.isFinite(target) && target > 0;
            // The title tells you WHICH market. Never show it when the body already
            // is the question (a fresh market), so the row never repeats itself.
            const norm = (x: string) => x.trim().replace(/\s+/g, " ").toLowerCase();
            const showTitle =
              showTitles &&
              navigable &&
              s.category !== "fresh_market" &&
              norm(r.marketTitle) !== norm(s.body);
            return (
              <li key={r.id} className={isNew(r.id) ? "tape-enter" : undefined}>
                <div
                  role={navigable ? "button" : undefined}
                  tabIndex={navigable ? 0 : undefined}
                  onClick={navigable ? () => onSelect?.(target) : undefined}
                  onKeyDown={
                    navigable
                      ? (event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onSelect?.(target);
                          }
                        }
                      : undefined
                  }
                  className={`block w-full rounded-[10px] px-2 py-2 text-left transition-colors ${navigable ? "hover:bg-[var(--surface-2)]" : ""}`}
                  // Personal (network) rows carry a faint "this is about you" wash —
                  // the only rows with a background, so belonging quietly stands out.
                  style={
                    personal
                      ? { background: "color-mix(in oklab, var(--rel,#9b87f5) 8%, transparent)" }
                      : undefined
                  }
                >
                  {/* WHEN → WHAT → WHY → WHO. Time first, headline loud, then the
                    one-sentence change, then a small muted attribution last. */}
                  <div className="text-[10px] font-medium tabular-nums text-[var(--text-muted)]">
                    {ago(r.occurredAt)}
                  </div>
                  <div className="mt-0.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--text)]">
                    <SideText text={s.headline} tone={s.tone} />
                  </div>
                  <div className="mt-0.5 text-[13px] leading-snug text-[var(--text-secondary)]">
                    <SideText text={s.body} />
                  </div>
                  {showTitle && (
                    <div className="mt-1 text-[11px] leading-snug text-[var(--text-muted)]">
                      {r.marketTitle}
                    </div>
                  )}
                  {/* WHO + HOW MUCH. Every row that has people ends with their
                    faces, and every row that has money ends with the money.
                    Faces left, amount right, one line — the stack is the way
                    into the profiles, the amount is the proof of conviction. */}
                  {(r.people?.length || r.face || r.amountUsd != null) && (
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="flex min-w-0 items-center gap-1.5">
                        {r.people && r.people.length > 0 ? (
                          // A discovery row IS the person — bigger faces there.
                          <PersonStack
                            people={r.people}
                            size={r.kind === "discovery_moment" ? 34 : 24}
                          />
                        ) : (
                          r.face && <AttributionFace r={r} />
                        )}
                        {s.attribution && (
                          <span className="truncate text-[11px] text-[var(--text-muted)]">
                            {s.attribution}
                          </span>
                        )}
                      </div>
                      {r.amountUsd != null && r.amountUsd > 0 && (
                        <span className="num ml-auto shrink-0 text-[11px] font-semibold text-[var(--text-secondary)]">
                          {usdShort(r.amountUsd)}
                        </span>
                      )}
                    </div>
                  )}

                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** A tiny face beside the attribution — clicking it opens that person. */
function AttributionFace({ r }: { r: LiveRow }) {
  if (!r.face) return null;
  return (
    <PersonAvatar
      wallet={r.wallet ?? r.id}
      name={r.face.name}
      avatarUrl={r.face.avatarUrl}
      size={16}
    />
  );
}

/**
 * Colour discipline: the only tinted glyphs in the tape are the words YES / NO
 * and signed percentages. Everything else stays neutral so the eye isn't asked
 * to decode a wall of red and green.
 */
function SideText({ text, tone }: { text: string; tone?: BeatTone }) {
  // A toned headline (e.g. "CAPITAL PULLED BACK") carries its direction; body text
  // stays neutral except the YES / NO words and any percentage.
  const toneColor =
    tone === "yes" || tone === "hot" ? "var(--yes)" : tone === "no" ? "var(--no)" : undefined;
  const parts = text.split(/(\bYES\b|\bNO\b|[+−-]?\d+(?:\.\d+)?%)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p === "YES" || p === "NO") {
          return (
            <span
              key={i}
              className="font-semibold"
              style={{ color: p === "YES" ? "var(--yes)" : "var(--no)" }}
            >
              {p}
            </span>
          );
        }
        if (/^[+−-]?\d+(?:\.\d+)?%$/.test(p)) {
          return (
            <span
              key={i}
              className="num font-semibold"
              style={{ color: p.startsWith("−") || p.startsWith("-") ? "var(--no)" : "var(--yes)" }}
            >
              {p}
            </span>
          );
        }
        return (
          <span key={i} style={toneColor ? { color: toneColor } : undefined}>
            {p}
          </span>
        );
      })}
    </>
  );
}
