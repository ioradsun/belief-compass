/**
 * "You might rather back" — right-rail suggestions shown while a market is
 * being created.
 *
 * Advisory by design: it sits above the live feed, never replaces it, never
 * blocks the Create button, and clicking a card is pure navigation — no
 * signature, no transaction. The feed keeps running underneath.
 */
import { useQuery } from "@tanstack/react-query";
import { dismissSuggestions, useSuggestionProbe } from "@/lib/create-draft";
import { suggestExistingMarkets } from "@/lib/market-create.functions";
import { useMoney } from "@/lib/display-unit";

const REASON: Record<string, string> = {
  "same-media": "Same media",
  "same-link": "Same link",
  similar: "Similar question",
};

export function DuplicateSuggestions({ onSelect }: { onSelect: (marketId: number) => void }) {
  const { format } = useMoney();
  const probe = useSuggestionProbe();
  const question = probe?.question.trim() ?? "";
  const enabled = !!probe && (question.length >= 8 || !!probe.sha256 || !!probe.linkUrl);

  // Debounce lives in the form's probe; the query key caches per normalized
  // input for the session and React Query cancels/replaces stale fetches.
  const { data } = useQuery({
    queryKey: ["market-suggestions", question.toLowerCase(), probe?.sha256, probe?.linkUrl],
    queryFn: () =>
      suggestExistingMarkets({
        data: { question, sha256: probe?.sha256 ?? null, linkUrl: probe?.linkUrl ?? null },
      }),
    enabled,
    staleTime: 5 * 60_000,
  });

  if (!enabled || !data?.length) return null;

  return (
    <section className="mb-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          You might rather back
        </span>
        <button
          type="button"
          onClick={dismissSuggestions}
          aria-label="Hide suggestions"
          className="px-1 text-[13px] leading-none text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
        >
          ×
        </button>
      </div>

      <ul className="space-y-2">
        {data.map((m) => (
          <li key={m.onchainId}>
            <button
              type="button"
              onClick={() => onSelect(m.onchainId)}
              className="w-full rounded-xl bg-[var(--surface)] p-3 text-left transition-colors hover:border-[var(--border-strong)]"
            >
              <div className="flex gap-2.5">
                {m.thumbUrl && (
                  <img
                    src={m.thumbUrl}
                    alt=""
                    loading="lazy"
                    className="h-10 w-10 shrink-0 rounded-md object-cover"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    {REASON[m.reason] ?? "Similar question"}
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-[var(--text)]">
                    {m.title}
                  </p>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--text-secondary)]">
                {m.backedUsd != null && (
                  <span className="num">{format(m.backedUsd, "USD")} backed</span>
                )}
                {m.believers != null && m.believers > 0 && (
                  <>
                    <span className="text-[var(--text-muted)]">·</span>
                    <span className="num">
                      {m.believers} {m.believers === 1 ? "believer" : "believers"}
                    </span>
                  </>
                )}
                {m.yesPct != null && (
                  <>
                    <span className="text-[var(--text-muted)]">·</span>
                    <span className="num">{Math.round(m.yesPct)}% yes</span>
                  </>
                )}
              </div>

              <span className="mt-2 inline-block text-[12px] font-semibold text-[var(--text)] underline underline-offset-2">
                Join this market
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
