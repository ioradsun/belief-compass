/**
 * LEFT COLUMN — four flat tabs, one interaction hierarchy:
 *   Feed        = what's coming up                 (click → market in center)
 *   Convictions = my relationships with markets    (click → market in center)
 *   Tribe       = people who stand with me         (click → person in center)
 *   Rivals      = people who stand against me      (click → person in center)
 * Tribe and Rivals were a nested sub-control before; promoting them removes a
 * layer of navigation and lets each list breathe. The active tab persists for
 * the session; panels never stack in one scroll area.
 *
 * FEED JOINED THEM, and the header's Feed button went away with it. That button
 * had two jobs fused together — "show me what's next" and "get me out of here" —
 * and the first is a rail concern the moment the rail can show it. The second
 * belongs to the panels doing the taking-over, which is where Terms and Create
 * already put it. One control removed, and the rail becomes the single place the
 * feed is steered from.
 *
 * THE FEED TAB IS THE ONLY ONE THAT WORKS SIGNED OUT, so this column no longer
 * waits for a wallet: the three personal panels carry their own connect prompt
 * rather than the whole rail collapsing into one. It is also the default tab on
 * a fresh session — the running order is the product's main loop, and the other
 * three have nothing to say until you have used it.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { networkQO } from "@/lib/network-query";
import { MyConvictions } from "@/components/MyConvictions";
import { NetworkPanel } from "@/components/NetworkPanel";
import { presentRelationship } from "@/domain/relationship";
import { type MarketRow } from "@/components/MarketCard";
import { getWallet, type VolumeWindow } from "@/lib/markets.functions";

type Tab = "feed" | "positions" | "tribe" | "rivals";
const TABS: Tab[] = ["feed", "positions", "tribe", "rivals"];
const KEY = "conviction:you-tab";

function initialTab(): Tab {
  try {
    const v = window.sessionStorage.getItem(KEY);
    if (v === "positions" || v === "tribe" || v === "rivals") return v;
    return "feed";
  } catch {
    return "feed";
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
  onOpenDashboard,
  initialNetwork,
  feedList,
  onOpenFeedTab,
  connectPrompt,
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
  /** Open the full Conviction Dashboard (P&L) in the center. */
  onOpenDashboard?: () => void;
  /** Force a people tab when a person/DNA view is active in the center. */
  initialNetwork?: boolean;
  /**
   * The running order, rendered by the route. Passed as a node rather than as
   * five more props: this column is about YOU, and threading the queue's state
   * through it would make it the owner of something it does not decide.
   */
  feedList?: ReactNode;
  /** How many markets are in the running order — the tab's count. */
  /** What the route does when the Feed tab is chosen (closing the Case File). */
  onOpenFeedTab?: () => void;
  /** Shown inside the three personal tabs when there is no wallet. */
  connectPrompt?: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>(() => (initialNetwork ? "tribe" : initialTab()));
  const [convictionCount, setConvictionCount] = useState<number | null>(null);
  const [counts, setCounts] = useState<{ tribe: number; rivals: number } | null>(null);
  const select = (t: Tab) => {
    setTab(t);
    if (t === "feed") onOpenFeedTab?.();
    try {
      window.sessionStorage.setItem(KEY, t);
    } catch {
      /* storage unavailable */
    }
  };

  // Counts must be on the tab strip whether or not that tab has ever been opened,
  // so the strip reads the same cached queries the panels use (React Query dedupes)
  // and only defers to a mounted panel's own, richer count when it has reported one.
  const { data: netData } = useQuery(networkQO(wallet));
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
    t === "feed" ? "For You" : t === "positions" ? "Convictions" : t === "tribe" ? "Tribe" : "Rivals";

  // The playlist tab carries no count: how many markets are queued is an
  // implementation detail, and no reader decides anything differently for it.
  const tabCount = (t: Tab): number | null =>
    t === "feed"
      ? null
      : t === "positions"
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
      {/* Quiet segmented control. Four tabs no longer divide 320px evenly —
          `flex-1` would clip "Convictions" — so each takes its natural width and
          the strip scrolls if a future label outgrows the rail. */}
      <div
        className="mb-4 flex overflow-x-auto rounded-[10px] p-0.5"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        role="tablist"
        aria-label="For You, Convictions, Tribe, or Rivals"
      >
        {TABS.map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            type="button"
            onClick={() => select(t)}
            className={`flex shrink-0 grow basis-0 flex-col items-center rounded-[8px] px-1.5 py-1 leading-tight transition-colors ${
              tab === t ? "bg-[var(--bg)] text-[var(--text)]" : "text-[var(--text-muted)]"
            }`}
          >
            <span className="text-[12px] font-medium whitespace-nowrap">{tabName(t)}</span>
            {tabCount(t) != null && (
              <span className="text-[11px] tabular-nums opacity-70">{tabCount(t)}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "feed" ? (
        feedList
      ) : !wallet && connectPrompt ? (
        /* The three personal tabs carry the connect prompt themselves. The rail
           used to be replaced by it wholesale, which also hid the one tab that
           works signed out. */
        connectPrompt
      ) : tab === "positions" ? (
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
            onOpenDashboard={onOpenDashboard}
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
