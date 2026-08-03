/**
 * "See your impact" — the quiet payoff for standing on a market and bringing
 * your tribe. Shown ONLY once a viewer's link has actually pulled people in, so
 * it never clutters a market they haven't shared. One confident line, computed
 * from the same believers/capital the market itself reports.
 */
import { useQuery } from "@tanstack/react-query";
import { getShareImpact } from "@/lib/share.functions";
import { readSessionToken } from "@/lib/wallet-session";

export function ShareImpact({
  marketId,
  wallet,
  className = "",
}: {
  marketId: number;
  wallet?: string | null;
  className?: string;
}) {
  const token = wallet ? readSessionToken(wallet) : null;
  const { data } = useQuery({
    queryKey: ["share-impact", wallet ?? null, marketId],
    queryFn: async () =>
      await getShareImpact({
        data: { wallet: wallet as string, sessionToken: token as string, marketId },
      }),
    enabled: !!wallet && !!token,
    staleTime: 60_000,
  });

  // Only speak up once the link has produced a real believer — an open alone
  // isn't worth interrupting the market for.
  if (!data || !data.impact.hasImpact) return null;

  return (
    <div
      className={`rounded-[12px] px-3.5 py-2.5 text-[13px] leading-snug ${className}`}
      style={{ border: "1px solid var(--border)", background: "var(--surface)" }}
    >
      <span className="text-[var(--text)]">{data.impact.headline}</span>
      {data.impact.sub && (
        <span className="mt-0.5 block text-[12px] text-[var(--text-muted)]">{data.impact.sub}</span>
      )}
    </div>
  );
}
