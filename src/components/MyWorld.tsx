/**
 * LEFT COLUMN — "You". Three flat tabs, one interaction hierarchy:
 *   Convictions = my relationships with markets  (click → market in center)
 *   Tribe       = people who stand with me        (click → person in center)
 *   Rivals      = people who stand against me      (click → person in center)
 * Tribe and Rivals were a nested sub-control before; promoting them removes a
 * layer of navigation and lets each list breathe. The active tab persists for
 * the session; panels never stack in one scroll area.
 */
import { useState } from "react";
import { MyConvictions } from "@/components/MyConvictions";
import { NetworkPanel } from "@/components/NetworkPanel";
import { type MarketRow } from "@/components/MarketCard";
import { type VolumeWindow } from "@/lib/markets.functions";

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

  const label = (t: Tab): string => {
    const name = t === "positions" ? "Convictions" : t === "tribe" ? "Tribe" : "Rivals";
    const n = t === "positions" ? convictionCount : t === "tribe" ? counts?.tribe : counts?.rivals;
    return n && n > 0 ? `${name} (${n})` : name;
  };

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
            className={`flex-1 rounded-[8px] px-2 py-1.5 text-[12px] font-medium transition-colors ${
              tab === t ? "bg-[var(--bg)] text-[var(--text)]" : "text-[var(--text-muted)]"
            }`}
          >
            {label(t)}
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
