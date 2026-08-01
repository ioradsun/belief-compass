/**
 * LiveTape — the right column: the living story of conviction. One chronological
 * stream of the server-grouped LiveRow DTO (canonical events, occurrence order);
 * it does NOT rank or reorder. Each row is read at a glance through a leading
 * glyph and a subtle class treatment (personal · community · market) from the
 * pure taxonomy — the user never picks a view. Personal rows (a Twin / someone in
 * your network) get a faint "about you" highlight but stay in time order. Text
 * wraps naturally with generous spacing; clicking a row selects that market.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listLiveEvents } from "@/lib/live.functions";
import { useStickyRows } from "@/hooks/useSticky";
import { hueFor, initialsFor } from "@/lib/wallet-identity";
import { mergeLiveRows, LIVE_DELTA_OVERLAP_MS, type LiveRow } from "@/lib/live-tape";
import type { BeatTone } from "@/domain/story";

type LiveResult = { rows: LiveRow[]; error: string | null };

/** Beyond this gap since our newest cached event, a delta would be large — just
 *  do a full fetch (the persisted cache already gave the instant paint). */
const MAX_DELTA_SPAN_MS = 30 * 60_000;

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
  excludeMarketId,
  limit,
  showTitles = true,
  emptyText = "No recent activity yet.",
  skeletonRows = 8,
}: {
  wallet?: string;
  onSelect: (marketId: number) => void;
  /** Scope the tape to one market (center deck) or a set (positions). */
  marketIds?: number[];
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
  const key = ["live-tape", wallet ?? null, scopeKey, limit ?? null];
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
        scopeKey === null && prev.length > 0 && Date.now() - newestMs <= MAX_DELTA_SPAN_MS;
      if (canDelta) {
        const sinceIso = new Date(newestMs - LIVE_DELTA_OVERLAP_MS).toISOString();
        const res = (await listLiveEvents({
          data: { wallet, limit, since: sinceIso },
        })) as LiveResult;
        if (res.error) return { rows: prev, error: res.error };
        return { rows: mergeLiveRows(prev, res.rows, sinceIso, limit ?? 120), error: null };
      }
      return (await listLiveEvents({
        data: { wallet, marketIds: scopeKey ?? undefined, limit },
      })) as LiveResult;
    },
    // New rows prepend; refetch keeps the tape fresh without new infra.
    refetchInterval: 6_000,
    placeholderData: (prev) => prev,
  });
  // Sticky: the tape holds its rows until fresh ones arrive.
  const sticky = useStickyRows(data?.rows);
  const rows =
    excludeMarketId == null ? sticky : sticky.filter((r) => Number(r.marketId) !== excludeMarketId);

  return (
    <div className="h-full min-h-0 flex-1 touch-pan-y overflow-y-scroll overscroll-contain [-webkit-overflow-scrolling:touch]">
      {isLoading && rows.length === 0 ? (
        <ul className="space-y-2" aria-hidden>
          {Array.from({ length: skeletonRows }).map((_, i) => (
            <li key={i} className="h-8 animate-pulse rounded bg-[var(--border)]/40" />
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">{emptyText}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => {
            const s = r.story;
            const personal = s.personal;
            // The title tells you WHICH market. Never show it when the body already
            // is the question (a fresh market), so the row never repeats itself.
            const norm = (x: string) => x.trim().replace(/\s+/g, " ").toLowerCase();
            const showTitle =
              showTitles && s.category !== "fresh_market" && norm(r.marketTitle) !== norm(s.body);
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onSelect(Number(r.marketId))}
                  className="block w-full rounded-[10px] px-2 py-2 text-left transition-colors hover:bg-[var(--border)]/25"
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
                  {s.attribution && (
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                      {r.face && <AttributionFace r={r} />}
                      <span className="truncate">{s.attribution}</span>
                    </div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** A tiny face beside the attribution — the truest "someone" signal, kept last. */
function AttributionFace({ r }: { r: LiveRow }) {
  if (!r.face) return null;
  return r.face.avatarUrl ? (
    <img src={r.face.avatarUrl} alt="" className="h-4 w-4 shrink-0 rounded-full object-cover" />
  ) : (
    <span
      className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-[7px] font-semibold text-white"
      style={{ background: `hsl(${hueFor(r.wallet ?? r.id)} 45% 45%)` }}
      aria-hidden
    >
      {initialsFor(r.face.name)}
    </span>
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
