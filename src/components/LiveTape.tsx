/**
 * LiveTape — the right column. A compact chronological activity tape. Reads the
 * server-grouped LiveRow DTO (canonical events, occurrence order); it does NOT
 * rank. It IS lightly personalized: when a row's sole actor is in your network
 * the server tags it with a real face + name ("Maya (Twin) backed YES"). Clicking
 * a row selects that market in the center.
 */
import { useQuery } from "@tanstack/react-query";
import { listLiveEvents } from "@/lib/live.functions";
import { useStickyRows } from "@/hooks/useSticky";
import { hueFor, initialsFor } from "@/lib/wallet-identity";

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
}: {
  wallet?: string;
  onSelect: (marketId: number) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["live-tape", wallet ?? null],
    queryFn: () => listLiveEvents({ data: { wallet } }),
    // New rows prepend; refetch keeps the tape fresh without new infra.
    refetchInterval: 6_000,
    placeholderData: (prev: unknown) => prev,
  });
  // Sticky: the tape holds its rows until fresh ones arrive.
  const rows = useStickyRows(data?.rows);

  return (
    <div className="min-h-0 flex-1">
      {isLoading && rows.length === 0 ? (
        <ul className="space-y-2" aria-hidden>
          {Array.from({ length: 8 }).map((_, i) => (
            <li key={i} className="h-8 animate-pulse rounded bg-[var(--border)]/40" />
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <p className="text-xs text-[var(--text-muted)]">No recent activity yet.</p>
      ) : (
        <ul className="space-y-0.5">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onSelect(Number(r.marketId))}
                className="flex w-full items-start gap-2 rounded px-1.5 py-1.5 text-left transition-colors hover:bg-[var(--border)]/30"
              >
                <span className="mt-0.5 w-8 shrink-0 text-[11px] tabular-nums text-[var(--text-muted)]">
                  {ago(r.occurredAt)}
                </span>
                {/* A real face only when the actor is in your network. */}
                {r.face &&
                  (r.face.avatarUrl ? (
                    <img
                      src={r.face.avatarUrl}
                      alt=""
                      className="mt-0.5 h-4 w-4 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <span
                      className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[7px] font-semibold text-white"
                      style={{ background: `hsl(${hueFor(r.wallet ?? r.id)} 45% 45%)` }}
                      aria-hidden
                    >
                      {initialsFor(r.face.name)}
                    </span>
                  ))}
                <span className="min-w-0 flex-1">
                  <span
                    className={`text-[13px] ${
                      r.side === "YES"
                        ? "text-emerald-500"
                        : r.side === "NO"
                          ? "text-rose-500"
                          : "text-[var(--text-secondary)]"
                    }`}
                  >
                    {r.text}
                  </span>
                  <span className="block truncate text-[11px] text-[var(--text-muted)]">
                    {r.marketTitle}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
