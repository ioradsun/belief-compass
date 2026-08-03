/**
 * SHARED CONVICTION — a compact, side-blind belonging signal.
 *
 * "You are not alone." When people from the viewer's network hold a position in
 * this market, we say so — but BEFORE the viewer decides we never reveal their
 * side, their amount, or whether they agree. We only surface the relationship
 * (your Tribe / a possible Twin / an Opp) and a few faces.
 *
 * Reuses the same query keys the rest of the deck runs, so it adds no requests.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMarketEvidence } from "@/lib/evidence.functions";
import { getNetwork } from "@/lib/dna.functions";
import { hueFor, initialsFor } from "@/lib/wallet-identity";

type Person = {
  wallet: string;
  displayName: string;
  avatarUrl: string | null;
  relationship: string;
};

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

  const here = useMemo(() => {
    if (!viewerWallet) return [];
    const holders = new Set((evidence?.believers ?? []).map((b) => b.wallet.toLowerCase()));
    // Only real relationships — a "neutral"/"insufficient" match isn't belonging.
    const meaningful = new Set(["twin", "tribe", "opp", "inverse"]);
    return (net?.people ?? []).filter(
      (p) => holders.has(p.wallet.toLowerCase()) && meaningful.has(p.relationship),
    ) as Person[];
  }, [evidence, net, viewerWallet]);

  if (!viewerWallet || here.length === 0) return null;

  const twin = here.find((p) => p.relationship === "twin");
  const rival = here.find((p) => p.relationship === "opp" || p.relationship === "inverse");
  const tribe = here.filter((p) => p.relationship === "tribe" || p.relationship === "twin");

  // One line, strongest signal first — never a side, never a number of shares.
  // (Side-blind by design: who is here, not which way they went.)
  const headline = twin
    ? "Your Twin is in this market"
    : tribe.length > 0
      ? `${tribe.length} ${tribe.length === 1 ? "person" : "people"} from your Tribe ${tribe.length === 1 ? "is" : "are"} here`
      : rival
        ? "One of your Rivals is here"
        : `${here.length} ${here.length === 1 ? "person" : "people"} from your circle ${here.length === 1 ? "is" : "are"} here`;

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
