/**
 * "Someone may already be asking this" — the LEFT rail during Launch Mode.
 *
 * WHAT THIS REPLACES. It was `DuplicateSuggestions`, and it sat in the RIGHT
 * rail above the live tape. That put it on the side of the screen that answers
 * "who should see this", next to a feed it had nothing to do with, while the
 * left rail — the column that already answers "where should I go" — showed the
 * running order the reader had just left. Moving it is the whole change: the
 * question "should I join an existing conversation instead of starting one?"
 * belongs beside the other ways of arriving at a market.
 *
 * IT CONSOLIDATES; IT DOES NOT RECOMMEND. Every market here is one the creator
 * might publish a second copy of. Semantic similarity is the GATE — a market
 * below the band does not appear at all, however busy it is — and activity only
 * orders rooms that are already equally close. That rule lives once, in
 * `byConsolidation`, and this component neither scores nor sorts.
 *
 * CONFIDENCE IN WORDS, NEVER A NUMBER. Measured across every pair retrieval
 * surfaces, the 0.90–1.00 band is 88% genuine duplicates — good enough to raise
 * an eyebrow, nowhere near good enough to tell someone their idea already
 * exists. So the only row that says "already exists" is an exact match after
 * normalisation, and everything else says how close it looks and leaves the
 * judgement to the person who wrote the question.
 *
 * Advisory, always: this never blocks Publish, and Join is pure navigation — no
 * signature, no transaction.
 */
import { useQuery } from "@tanstack/react-query";
import { dismissSuggestions, useSuggestionProbe } from "@/lib/create-draft";
import { recordSimilarJoin, suggestExistingMarkets } from "@/lib/market-create.functions";
import type { MarketSuggestion } from "@/lib/market-create.server";
import { useMoney } from "@/lib/display-unit";

/**
 * What each row claims, strongest first.
 *
 * `same-media` / `same-link` are identity, not similarity — the same bytes or
 * the same URL is a fact, so they outrank anything the text scorer can say.
 * Below them the band speaks, and only an exact normalised match is allowed the
 * word "already".
 */
function claimFor(m: MarketSuggestion): string {
  if (m.reason === "same-media") return "Same media";
  if (m.reason === "same-link") return "Same link";
  if (m.band === "duplicate") return "This question already exists";
  if (m.band === "ambiguous") return "Very close to yours";
  return "Related question";
}

/** "2h ago" / "3d ago", or null when nothing has ever happened here. */
function activityText(ms: number | null): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  const mins = Math.max(0, Math.floor((Date.now() - ms) / 60_000));
  if (mins < 60) return `active ${Math.max(1, mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `active ${hours}h ago`;
  return `active ${Math.floor(hours / 24)}d ago`;
}

export function SimilarMarkets({
  wallet,
  onJoin,
}: {
  wallet?: string;
  onJoin: (marketId: number) => void;
}) {
  const { format } = useMoney();
  const probe = useSuggestionProbe();
  const question = probe?.question.trim() ?? "";
  const enabled = !!probe && (question.length >= 8 || !!probe.sha256 || !!probe.linkUrl);

  // The debounce lives in the form's probe; the query key caches per normalized
  // input for the session and React Query cancels/replaces stale fetches. No
  // second retrieval path — this is the same server function the right rail
  // called, moved rather than reimplemented.
  const { data } = useQuery({
    queryKey: ["market-suggestions", question.toLowerCase(), probe?.sha256, probe?.linkUrl],
    queryFn: () =>
      suggestExistingMarkets({
        data: { question, sha256: probe?.sha256 ?? null, linkUrl: probe?.linkUrl ?? null },
      }),
    enabled,
    staleTime: 5 * 60_000,
  });

  // QUIET WHEN NOTHING MATCHES, and quiet is the honest answer most of the time.
  // A panel that renders "no similar markets" on every keystroke would train the
  // reader to stop looking at the one time it has something to say.
  if (!enabled || !data?.length) return null;

  return (
    <section className="mb-4 shrink-0">
      <div className="mb-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Already being debated
          </span>
          {/* Kept from the right-rail version: consolidation is advice, and a
              creator who has decided must be able to make it stop. */}
          <button
            type="button"
            onClick={dismissSuggestions}
            aria-label="Hide similar markets"
            className="px-1 text-[13px] leading-none text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
          >
            ×
          </button>
        </div>

      </div>

      <ul className="space-y-2">
        {data.map((m) => {
          const activity = activityText(m.lastActivityMs);
          const believers = m.believers ?? 0;
          return (
            <li key={m.onchainId}>
              <button
                type="button"
                onClick={() => {
                  // THE MEASUREMENT THIS PANEL NEVER HAD. Without it, a
                  // consolidation feature that diverts nobody is
                  // indistinguishable from one that works. Fired before
                  // navigating and never awaited — the click is the product.
                  void recordSimilarJoin({
                    data: { wallet: wallet ?? null, marketId: m.onchainId },
                  }).catch(() => undefined);
                  onJoin(m.onchainId);
                }}
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left transition-colors hover:border-[var(--border-strong)]"
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
                    <div
                      className="text-[10px] font-semibold uppercase tracking-wide"
                      style={{
                        // The strongest claim is the only one that gets the
                        // full-contrast treatment; a "related question" must not
                        // look like an accusation.
                        color:
                          m.band === "duplicate" || m.reason !== "similar"
                            ? "var(--text)"
                            : "var(--text-muted)",
                      }}
                    >
                      {claimFor(m)}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-[var(--text)]">
                      {m.title}
                    </p>
                  </div>
                </div>

                {/* WHO IS IN THE ROOM — the reason to join one rather than the
                    other, and the only thing activity is allowed to decide. */}
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--text-secondary)]">
                  <span className="num">
                    {believers === 0
                      ? "No one here yet"
                      : `${believers} ${believers === 1 ? "believer" : "believers"}`}
                  </span>
                  {m.backedUsd != null && m.backedUsd > 0 && (
                    <>
                      <span className="text-[var(--text-muted)]">·</span>
                      <span className="num">{format(m.backedUsd, "USD")} backed</span>
                    </>
                  )}
                  {m.yesPct != null && believers > 0 && (
                    <>
                      <span className="text-[var(--text-muted)]">·</span>
                      <span className="num">{Math.round(m.yesPct)}% yes</span>
                    </>
                  )}
                  {activity && (
                    <>
                      <span className="text-[var(--text-muted)]">·</span>
                      <span className="num">{activity}</span>
                    </>
                  )}
                </div>

                <span className="mt-2 inline-block text-[12px] font-semibold text-[var(--text)] underline underline-offset-2">
                  Join this debate
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
