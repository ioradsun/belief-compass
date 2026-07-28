/**
 * LEFT COLUMN — "You". Two equal tabs sharing one interaction hierarchy:
 *   Positions = my relationships with markets  (click → market in center)
 *   Network   = my relationships with people   (click → person in center)
 * The active tab persists for the session. Full available height; the two panels
 * never stack in one scroll area.
 */
import { useState } from "react";
import { MyConvictions } from "@/components/MyConvictions";
import { NetworkPanel } from "@/components/NetworkPanel";
import { type MarketRow } from "@/components/MarketCard";
import { type VolumeWindow } from "@/lib/markets.functions";

type Tab = "positions" | "network";
const KEY = "conviction:you-tab";

function initialTab(): Tab {
  try {
    return window.sessionStorage.getItem(KEY) === "network" ? "network" : "positions";
  } catch {
    return "positions";
  }
}

export function MyWorld({
  wallet,
  rows,
  window: win,
  winLabel,
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
  onSelectMarket: (id: number) => void;
  selectedPerson?: string;
  onSelectPerson: (wallet: string) => void;
  onOpenDna: () => void;
  /** Force the Network tab when a person/DNA view is active in the center. */
  initialNetwork?: boolean;
}) {
  const [tab, setTab] = useState<Tab>(() => (initialNetwork ? "network" : initialTab()));
  const select = (t: Tab) => {
    setTab(t);
    try {
      window.sessionStorage.setItem(KEY, t);
    } catch {
      /* storage unavailable */
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Quiet segmented control */}
      <div
        className="mb-4 flex rounded-[10px] p-0.5"
        style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        role="tablist"
        aria-label="Positions or Network"
      >
        {(["positions", "network"] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            type="button"
            onClick={() => select(t)}
            className={`flex-1 rounded-[8px] px-3 py-1.5 text-[12px] font-medium capitalize transition-colors ${
              tab === t ? "bg-[var(--bg)] text-[var(--text)]" : "text-[var(--text-muted)]"
            }`}
          >
            {t}
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
            onSelect={onSelectMarket}
          />
        </div>
      ) : (
        <NetworkPanel
          wallet={wallet}
          selectedPerson={selectedPerson}
          onSelectPerson={onSelectPerson}
          onOpenDna={onOpenDna}
        />
      )}
    </div>
  );
}
