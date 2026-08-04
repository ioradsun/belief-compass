/**
 * LEFT COLUMN — "You". Three flat tabs, one interaction hierarchy:
 *   Convictions = my relationships with markets  (click → market in center)
 *   Tribe       = people who stand with me        (click → person in center)
 *   Rivals      = people who stand against me      (click → person in center)
 * Tribe and Rivals were a nested sub-control before; promoting them removes a
 * layer of navigation and lets each list breathe. The active tab persists for
 * the session; panels never stack in one scroll area.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MyConvictions } from "@/components/MyConvictions";
import { NetworkPanel } from "@/components/NetworkPanel";
import { getNetwork } from "@/lib/dna.functions";
import { presentRelationship } from "@/domain/relationship";
import { type MarketRow } from "@/components/MarketCard";
import { getWallet, type VolumeWindow } from "@/lib/markets.functions";

type Tab = "positions" | "tribe" | "rivals";
const KEY = "conviction:you-tab";

function initialTab(): Tab {
  try {
    const v = window.sessionStorage.getItem(KEY);
    if (v === "tribe" || v === "rivals") return v;
    return "positions";
  } catch {
    return "positions";
  }
}

export function MyWorld({
  wallet,
  rows,
  window: win,
  winLabel,
  ethUsd = 0,
  onSelectMarket,
  selectedPerson,
  onSelectPerson,
  onOpenDna,
  initialNetwork,
}: {
  wallet?: string;
  rows: MarketRow[];
  window?: VolumeWindow;
  winLabel?: string;
  /** Live ETH/USD rate, forwarded so positions render in the chosen unit. */
  ethUsd?: number;
  onSelectMarket: (id: number) => void;
  selectedPerson?: string;
  onSelectPerson: (wallet: string) => void;
  onOpenDna: () => void;
  /** Force a people tab when a person/DNA view is active in the center. */
  initialNetwork?: boolean;
}) {
  const [tab, setTab] = useState<Tab>(() => (initialNetwork ? "tribe" : initialTab()));
  const [convictionCount, setConvictionCount] = useState<number | null>(null);
  const [counts, setCounts] = useState<{ tribe: number; rivals: number } | null>(null);
  const select = (t: Tab) => {
    setTab(t);
    try {
      window.sessionStorage.setItem(KEY, t);
    } catch {
      /* storage unavailable */
    }
  };

  // Counts must be on the tab strip whether or not that tab has ever been opened,
  // so the strip reads the same cached queries the panels use (React Query dedupes)
  // and only defers to a mounted panel's own, richer count when it has reported one.
  const { data: netData } = useQuery({
    queryKey: ["network", wallet ?? null, "all", "relevant", ""],
    queryFn: () =>
      getNetwork({
        data: { wallet, relationship: "all", sort: "relevant", query: "", limit: 60 },
      }),
    enabled: !!wallet,
    placeholderData: (prev) => prev,
    refetchInterval: 60_000,
  });
  const netCounts = useMemo(() => {
    let tribe = 0;
    let rivals = 0;
    for (const p of netData?.people ?? []) {
      const g = presentRelationship({
        agreement: p.agreement,
        sharedConvictions: p.sharedBeliefs,
        together: p.together,
        apart: p.apart,
        topicCount: p.topicCount,
        strongestAlignedTopic: p.strongestAlignedDomain?.name ?? null,
        strongestOpposedTopic: p.strongestOpposedDomain?.name ?? null,
      }).group;
      if (g === "tribe") tribe += 1;
      else if (g === "rival") rivals += 1;
    }
    return { tribe, rivals };
  }, [netData]);

  const { data: walletData } = useQuery({
    queryKey: ["my-convictions", wallet ?? null, win ?? "24h"],
    queryFn: async () =>
      await getWallet({ data: { wallet: wallet as string, window: win ?? "24h" } }),
    enabled: !!wallet,
    placeholderData: (prev) => prev,
    refetchInterval: 30_000,
  });
  const positionCount = useMemo(
    () =>
      (walletData?.positions ?? []).filter((p) => {
        const side = p.stance_side === "YES" || p.stance_side === "NO" ? p.stance_side : null;
        if (!side) return false;
        const shares = Number((side === "YES" ? p.yes_shares : p.no_shares) ?? 0);
        return shares > 0;
      }).length,
    [walletData],
  );

  const tabName = (t: Tab): string =>
    t === "positions" ? "Convictions" : t === "tribe" ? "Tribe" : "Rivals";

  const tabCount = (t: Tab): number =>
    t === "positions"
      ? (convictionCount ?? positionCount)
      : t === "tribe"
        ? (counts?.tribe ?? netCounts.tribe)
        : (counts?.rivals ?? netCounts.rivals);

  const exploreMarkets = () => {
    const first = rows[0];
    if (first) onSelectMarket(Number(first.onchain_id));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Quiet segmented control */}
      <div
        className="mb-4 flex rounded-[10px] p-0.5"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        role="tablist"
        aria-label="Convictions, Tribe, or Rivals"
      >
        {(["positions", "tribe", "rivals"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            type="button"
            onClick={() => select(t)}
            className={`flex flex-1 flex-col items-center rounded-[8px] px-2 py-1 leading-tight transition-colors ${
              tab === t ? "bg-[var(--bg)] text-[var(--text)]" : "text-[var(--text-muted)]"
            }`}
          >
            <span className="text-[12px] font-medium">{tabName(t)}</span>
            <span className="text-[11px] tabular-nums opacity-70">{tabCount(t)}</span>
          </button>
        ))}
      </div>

      {tab === "positions" ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <MyConvictions
            wallet={wallet}
            rows={rows}
            window={win}
            winLabel={winLabel}
            ethUsd={ethUsd}
            onSelect={onSelectMarket}
            onCount={setConvictionCount}
            onExplore={exploreMarkets}
          />
        </div>
      ) : (
        <NetworkPanel
          wallet={wallet}
          group={tab}
          selectedPerson={selectedPerson}
          onSelectPerson={onSelectPerson}
          onCounts={setCounts}
          onOpenDna={onOpenDna}
          onExplore={exploreMarkets}
        />
      )}
    </div>
  );
}
