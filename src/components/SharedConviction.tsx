/**
 * SHARED CONVICTION — a compact belonging signal: who from your network is here,
 * and which way they went.
 *
 * "You are not alone." The line used to stop before the useful half — it named
 * the relationship and withheld the side, on the grounds that the viewer had not
 * decided yet. The believers query it already runs carries every person's side,
 * so this component loaded the answer and dropped it, and the one surface that
 * mentions your people was the only one that would not tell you anything about
 * them. See @/domain/shared-conviction for what the sentence still refuses to
 * say, and why none of those are privacy rules either.
 *
 * Reuses the same query keys the rest of the deck runs, so it adds no requests.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMarketEvidence } from "@/lib/evidence.functions";
import { getNetwork } from "@/lib/dna.functions";
import { hueFor, initialsFor } from "@/lib/wallet-identity";
import { sharedConvictionLine, type PresentPerson } from "@/domain/shared-conviction";

/**
 * A network member present in this market. `relationship` is the narrowed union
 * rather than a string so this list can be handed straight to the composer —
 * the filter below is what guarantees it.
 */
type Person = PresentPerson & {
  displayName: string;
  avatarUrl: string | null;
};

const MEANINGFUL = ["twin", "tribe", "opp", "inverse"] as const;
const isMeaningful = (r: string): r is PresentPerson["relationship"] =>
  (MEANINGFUL as readonly string[]).includes(r);

export function SharedConviction({
  marketId,
  viewerWallet,
  onSelectPerson,
}: {
  marketId: number;
  viewerWallet?: string;
  onSelectPerson?: (wallet: string) => void;
}) {
  const { data: evidence } = useQuery({
    queryKey: ["evidence", marketId],
    queryFn: () => getMarketEvidence({ data: { marketId } }),
    refetchInterval: 60_000,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  const { data: net } = useQuery({
    queryKey: ["network", viewerWallet ?? null, "all", "relevant", ""],
    queryFn: () => getNetwork({ data: { wallet: viewerWallet, limit: 60 } }),
    enabled: !!viewerWallet,
    staleTime: 60_000,
  });

  const here = useMemo<Person[]>(() => {
    if (!viewerWallet) return [];
    // The side travels WITH the person. A bare Set of wallets is what dropped it
    // before — the map is the fix, not an extra lookup.
    const sideOf = new Map<string, "YES" | "NO">();
    for (const b of evidence?.believers ?? []) sideOf.set(b.wallet.toLowerCase(), b.side);
    const out: Person[] = [];
    for (const p of net?.people ?? []) {
      const w = p.wallet.toLowerCase();
      // Only real relationships — a "neutral"/"insufficient" match isn't belonging.
      if (!sideOf.has(w) || !isMeaningful(p.relationship)) continue;
      out.push({
        wallet: p.wallet,
        relationship: p.relationship,
        side: sideOf.get(w) ?? null,
        displayName: p.displayName,
        avatarUrl: p.avatarUrl,
      });
    }
    return out;
  }, [evidence, net, viewerWallet]);

  const headline = sharedConvictionLine(here);
  if (!viewerWallet || !headline) return null;

  const faces = here.slice(0, 3);
  const extra = here.length - faces.length;

  return (
    <section aria-label="Shared conviction" className="flex items-center gap-2.5">
      <div className="flex shrink-0 -space-x-2">
        {faces.map((p) => (
          <button
            key={p.wallet}
            type="button"
            onClick={() => onSelectPerson?.(p.wallet)}
            aria-label={p.displayName}
            className="rounded-full ring-2 ring-[var(--bg)] transition-transform hover:z-10 hover:-translate-y-px"
          >
            {p.avatarUrl ? (
              <img src={p.avatarUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
            ) : (
              <span
                className="grid h-6 w-6 place-items-center rounded-full text-[9px] font-semibold text-white"
                style={{ background: `hsl(${hueFor(p.wallet)} 45% 45%)` }}
                aria-hidden
              >
                {initialsFor(p.displayName)}
              </span>
            )}
          </button>
        ))}
        {extra > 0 && (
          <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--surface)] text-[9px] font-semibold text-[var(--text-secondary)] ring-2 ring-[var(--bg)]">
            +{extra}
          </span>
        )}
      </div>
      <span className="min-w-0 flex-1 text-[12px] leading-snug text-[var(--text-secondary)]">
        {headline}
      </span>
    </section>
  );
}
