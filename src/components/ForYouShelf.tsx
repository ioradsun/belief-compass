/**
 * FOR YOU — the only place a person-to-person signal can arrive.
 *
 * This platform has no notification channel. No email, no web push, no service
 * worker, no inbox, no unread state. An invitation is a stored row somebody
 * finds the next time they open the app, which makes this shelf the ENTIRE
 * delivery mechanism rather than a garnish on one. If it degrades into "here is
 * what's new", nothing else picks up the slack.
 *
 * SO THE RULE IS ABSOLUTE: a row may appear only if the system can state why
 * THIS person. That rule lives in `@/domain/for-you` and is enforced there —
 * this component renders `reason` and has no way to invent one, which is the
 * point. There is no fallback string anywhere in the path.
 *
 * IT SITS ABOVE THE LIVE TAPE, and the difference between the two is the whole
 * design. The tape is what is happening; this is what is happening TO YOU.
 * Anything that cannot tell them apart belongs in the tape.
 *
 * QUIET WHEN IT HAS NOTHING. Measured platform-wide: 95% of wallets have no
 * Tribe, no wallet has a Rival, and there are no follow edges yet. An empty
 * shelf is the honest and common answer, and rendering "nothing for you" every
 * load would teach people to stop looking at the one time it speaks.
 */
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getForYou, markInviteSeen } from "@/lib/launch.functions";
import type { ForYouKind } from "@/domain/for-you";

/** A word for where the row came from. Never a claim, just a label. */
const KIND_LABEL: Record<ForYouKind, string> = {
  invited: "Invited",
  rival: "Challenged",
  tribe: "Your Tribe",
  followed: "You follow",
  similar: "Like yours",
};

export function ForYouShelf({
  wallet,
  onSelect,
}: {
  wallet?: string;
  onSelect: (marketId: number) => void;
}) {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["for-you", wallet ?? null],
    queryFn: () => getForYou({ data: { wallet: wallet ?? null } }),
    enabled: !!wallet,
    staleTime: 60_000,
  });

  const rows = data ?? [];

  /**
   * "It reached them" — recorded once, on the first render that actually shows
   * an invitation, rather than on click. The distinction matters for Launch
   * Progress: Viewed and Joined are different rungs, and marking a view only
   * when someone clicks would collapse them into one and make the ladder
   * unable to show the gap it exists to show.
   */
  const seen = useRef(new Set<number>());
  // Depends on `data`, not on the `?? []` below: a fresh empty array every
  // render would re-run this on every render. The ref makes that harmless, but
  // "harmless because something else stops it" is not a reason to leave it.
  useEffect(() => {
    if (!wallet || !data) return;
    const fresh = data.filter((r) => r.kind === "invited" && !seen.current.has(r.marketId));
    if (fresh.length === 0) return;
    for (const r of fresh) seen.current.add(r.marketId);
    void Promise.all(
      fresh.map((r) =>
        markInviteSeen({ data: { wallet, marketId: r.marketId } }).catch(() => undefined),
      ),
    );
  }, [data, wallet]);

  if (!wallet || rows.length === 0) return null;

  return (
    <section className="mb-4 shrink-0">
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
          For you
        </span>
        <button
          type="button"
          onClick={() => void qc.invalidateQueries({ queryKey: ["for-you", wallet] })}
          className="text-[11px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)]"
        >
          Refresh
        </button>
      </div>

      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.marketId}>
            <button
              type="button"
              onClick={() => onSelect(r.marketId)}
              className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left transition-colors hover:border-[var(--border-strong)]"
            >
              <div
                className="text-[10px] font-semibold uppercase tracking-wide"
                style={{
                  // Someone naming you reads at full strength; a computed match
                  // is quieter, because it is a weaker claim about you.
                  color: r.kind === "invited" ? "var(--text)" : "var(--text-muted)",
                }}
              >
                {KIND_LABEL[r.kind]}
              </div>
              <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-[var(--text)]">
                {r.title}
              </p>
              {/* WHY YOU. Not a subtitle — the admission ticket, rendered. */}
              <p className="mt-1 line-clamp-2 text-[11.5px] leading-snug text-[var(--text-secondary)]">
                {r.reason}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
