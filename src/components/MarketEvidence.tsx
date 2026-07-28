/**
 * The deck's proof section: three tabs of real evidence for the open market.
 *   • Price — the trader's view: current odds, payout per $1, 60-day range and
 *     trend, plus where the money actually sits.
 *   • Believers — actual holders per side, with faces, conviction and days held.
 *   • Defense — the case each side is making, from pov.co agent opinions.
 * Server-owned via getMarketEvidence; this only renders. Compact + self-scrolling
 * so it never fights the decision dock for space.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMarketEvidence, type Believer, type DefenseOpinion } from "@/lib/evidence.functions";
import { getNetwork } from "@/lib/dna.functions";
import { useEffectiveWallet } from "@/hooks/useEffectiveWallet";
import { hueFor, initialsFor } from "@/lib/wallet-identity";

type Tab = "believers" | "price" | "defense";

/** Everything the price story needs, straight from the market read-model row. */
export interface PriceFacts {
  yesPrice: number | null;
  noPrice: number | null;
  chgYes: number | null;
  yesCapital: number | null;
  noCapital: number | null;
  volumeUsd: number | null;
  moneyYesPct: number | null;
  peopleYesPct: number | null;
}

export function MarketEvidence({ marketId, facts }: { marketId: number; facts?: PriceFacts }) {
  const [tab, setTab] = useState<Tab>("price");
  const viewer = useEffectiveWallet();
  const { data, isLoading } = useQuery({
    queryKey: ["evidence", marketId],
    queryFn: () => getMarketEvidence({ data: { marketId } }),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // People already in the viewer's network float to the top of each column.
  const { data: net } = useQuery({
    queryKey: ["network", viewer ?? null, "all", "relevant", ""],
    queryFn: () => getNetwork({ data: { wallet: viewer, limit: 60 } }),
    enabled: !!viewer,
    staleTime: 60_000,
  });
  const networkWallets = new Set((net?.people ?? []).map((p) => p.wallet.toLowerCase()));

  const counts = data ? { believers: data.believers.length } : { believers: 0 };

  return (
    <div>
      <div className="flex gap-4 border-b" style={{ borderColor: "var(--border)" }}>
        <TabBtn on={tab === "price"} onClick={() => setTab("price")}>
          Price
        </TabBtn>
        <TabBtn on={tab === "believers"} onClick={() => setTab("believers")}>
          Believers{counts.believers ? ` ${counts.believers}` : ""}
        </TabBtn>

        <TabBtn on={tab === "defense"} onClick={() => setTab("defense")}>
          Defense{data?.defense.length ? ` ${data.defense.length}` : ""}
        </TabBtn>
      </div>
      <div className="max-h-[220px] overflow-y-auto pt-1.5">
        {isLoading && !data ? (
          <div className="space-y-1.5 py-2">
            <div className="h-6 animate-pulse rounded bg-[var(--border)]/50" />
            <div className="h-6 w-2/3 animate-pulse rounded bg-[var(--border)]/50" />
          </div>
        ) : tab === "believers" ? (
          <BelieversSplit believers={data?.believers ?? []} networkWallets={networkWallets} />
        ) : tab === "price" ? (
          <PriceHistory series={data?.priceSeries ?? []} />
        ) : (
          <Defense opinions={data?.defense ?? []} />
        )}
      </div>
    </div>
  );
}

function TabBtn({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-mb-px border-b-2 pb-1.5 text-[12px] font-semibold transition-colors"
      style={{
        borderColor: on ? "var(--text)" : "transparent",
        color: on ? "var(--text)" : "var(--text-muted)",
      }}
    >
      {children}
    </button>
  );
}

/** Two columns that mirror the YES/NO decision: everyone on each side. */
function BelieversSplit({
  believers,
  networkWallets,
}: {
  believers: Believer[];
  networkWallets: Set<string>;
}) {
  if (believers.length === 0) {
    return <Empty>No directional holders yet — be the first to take a side.</Empty>;
  }
  const order = (a: Believer, b: Believer) => {
    const an = networkWallets.has(a.wallet.toLowerCase()) ? 1 : 0;
    const bn = networkWallets.has(b.wallet.toLowerCase()) ? 1 : 0;
    return bn - an || b.conviction - a.conviction;
  };
  const yes = believers.filter((b) => b.side === "YES").sort(order);
  const no = believers.filter((b) => b.side === "NO").sort(order);

  return (
    <div className="grid grid-cols-2 gap-2 py-1">
      <SideColumn side="YES" people={yes} networkWallets={networkWallets} />
      <SideColumn side="NO" people={no} networkWallets={networkWallets} />
    </div>
  );
}

function SideColumn({
  side,
  people,
  networkWallets,
}: {
  side: "YES" | "NO";
  people: Believer[];
  networkWallets: Set<string>;
}) {
  const color = side === "YES" ? "var(--yes)" : "var(--no)";
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between px-0.5">
        <span className="text-[11px] font-semibold" style={{ color }}>
          {side}
        </span>
        <span className="num text-[11px] text-[var(--text-muted)]">{people.length}</span>
      </div>
      {people.length === 0 ? (
        <div className="px-0.5 py-2 text-[11px] text-[var(--text-muted)]">No one yet</div>
      ) : (
        <ul className="space-y-0.5">
          {people.map((b) => {
            const inNetwork = networkWallets.has(b.wallet.toLowerCase());
            return (
              <li
                key={b.wallet}
                className="flex items-center gap-1.5 rounded-[8px] px-1 py-1"
                style={inNetwork ? { background: "var(--surface-2,var(--border))" } : undefined}
              >
                {b.avatarUrl ? (
                  <img src={b.avatarUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
                ) : (
                  <span
                    className="grid h-5 w-5 place-items-center rounded-full text-[8px] font-semibold text-white"
                    style={{ background: `hsl(${hueFor(b.wallet)} 45% 45%)` }}
                    aria-hidden
                  >
                    {initialsFor(b.name)}
                  </span>
                )}
                <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text)]">
                  {b.name}
                </span>
                {b.daysHeld > 0 && (
                  <span className="num text-[10px] text-[var(--text-muted)]">{b.daysHeld}d</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PriceHistory({ series }: { series: { date: string; yesPct: number }[] }) {
  if (series.length < 2) {
    return <Empty>Not enough price history yet — it builds as the market trades.</Empty>;
  }
  const w = 280;
  const h = 96;
  const pad = 4;
  const xs = series.map((_, i) => pad + (i * (w - 2 * pad)) / (series.length - 1));
  const ys = series.map((p) => {
    const v = Math.max(0, Math.min(100, p.yesPct));
    return pad + ((100 - v) * (h - 2 * pad)) / 100;
  });
  const path = xs
    .map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${ys[i].toFixed(1)}`)
    .join(" ");
  const last = series[series.length - 1].yesPct;
  const first = series[0].yesPct;
  const delta = last - first;
  const mid = pad + ((100 - 50) * (h - 2 * pad)) / 100;

  return (
    <div className="py-1">
      <div className="mb-1 flex items-baseline justify-between px-1">
        <span className="num text-[13px] font-semibold text-[var(--text)]">
          {last.toFixed(0)}% YES
        </span>
        <span
          className="num text-[11px] font-semibold"
          style={{ color: delta >= 0 ? "var(--yes)" : "var(--no)" }}
        >
          {delta >= 0 ? "+" : "−"}
          {Math.abs(delta).toFixed(0)} pts · {series.length}d
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="YES share over time">
        <line
          x1={pad}
          y1={mid}
          x2={w - pad}
          y2={mid}
          stroke="var(--border)"
          strokeDasharray="3 3"
          strokeWidth={1}
        />
        <path
          d={path}
          fill="none"
          stroke="var(--text-secondary)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

function Defense({ opinions }: { opinions: DefenseOpinion[] }) {
  if (opinions.length === 0) {
    return <Empty>No one's made their case here yet — the floor is open.</Empty>;
  }
  return (
    <ul className="space-y-1.5 py-1">
      {opinions.map((o, i) => (
        <li key={i} className="flex gap-2">
          {o.avatarUrl ? (
            <img
              src={o.avatarUrl}
              alt=""
              className="mt-0.5 h-6 w-6 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span
              className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[9px] font-semibold text-white"
              style={{ background: `hsl(${hueFor(o.name)} 45% 45%)` }}
              aria-hidden
            >
              {initialsFor(o.name)}
            </span>
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[12px] font-semibold text-[var(--text)]">
                {o.name}
              </span>
              <span
                className="rounded px-1 py-0.5 text-[9px] font-semibold"
                style={{
                  color: o.vote === "YES" ? "var(--yes)" : "var(--no)",
                  background: "var(--surface-2,var(--border))",
                }}
              >
                {o.vote}
              </span>
            </div>
            <p className="text-[12px] leading-snug text-[var(--text-secondary)]">{o.opinion}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2 py-4 text-center text-[12px] leading-relaxed text-[var(--text-muted)]">
      {children}
    </div>
  );
}
