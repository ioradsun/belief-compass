/**
 * LEFT PANEL — "My Convictions".
 *
 * Presentation only: portfolio summary (neutral grey change line), then one
 * position card per open belief, each with a live line reusing the same pulse
 * data the market cards run on. Green/red are reserved for the YES/NO pill.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { getWallet, type Pulse } from "@/lib/markets.functions";
import type { MarketRow } from "@/components/MarketCard";
import { WalletConnectButton } from "@/components/WalletConnect";

type Position = {
  onchain_id: number;
  stance_side: string | null;
  yes_shares: number | null;
  no_shares: number | null;
  markets?: { title?: string | null } | null;
};

function usd(n: number) {
  const v = Math.abs(n);
  const s = v >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v.toFixed(0);
  return `${n < 0 ? "−" : ""}$${s}`;
}
function signedUsd(n: number) {
  return `${n < 0 ? "−" : "+"}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
function signedPct(n: number) {
  return `${n < 0 ? "−" : "+"}${Math.abs(n).toFixed(1)}%`;
}
function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function MyConvictions({
  wallet,
  rows,
  pulses,
}: {
  wallet?: string;
  rows: MarketRow[];
  pulses: Record<string, Pulse[]>;
}) {
  const { data } = useQuery({
    queryKey: ["my-convictions", wallet ?? null],
    queryFn: async () => await getWallet({ data: { wallet: wallet as string } }),
    enabled: !!wallet,
    refetchInterval: 30_000,
  });

  const byId = new Map<number, MarketRow>();
  for (const r of rows) byId.set(Number(r.onchain_id), r);

  const positions = ((data?.positions ?? []) as Position[])
    .map((p) => {
      const id = Number(p.onchain_id);
      const m = byId.get(id);
      const side = p.stance_side === "NO" ? "NO" : p.stance_side === "YES" ? "YES" : null;
      if (!side || !m) return null;
      const shares = Number((side === "YES" ? p.yes_shares : p.no_shares) ?? 0);
      const price = Number((side === "YES" ? m.yes_price_usd : m.no_price_usd) ?? 0);
      const value = shares * price;
      if (!(value > 0)) return null;
      const chg = Number(
        (side === "YES" ? m.chg_window_yes : m.chg_window_no) ??
          (side === "YES" ? m.chg_24h_yes : m.chg_24h_no) ??
          0,
      );
      return {
        id,
        side,
        value,
        chg,
        title: p.markets?.title ?? `Market #${id}`,
        pulse: (pulses[String(id)] ?? [])[0] ?? null,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b!.value - a!.value) as {
    id: number;
    side: "YES" | "NO";
    value: number;
    chg: number;
    title: string;
    pulse: Pulse | null;
  }[];

  const total = positions.reduce((s, p) => s + p.value, 0);
  const prev = positions.reduce((s, p) => s + p.value / (1 + p.chg / 100 || 1), 0);
  const deltaUsd = total - prev;
  const deltaPct = prev > 0 ? (deltaUsd / prev) * 100 : 0;

  return (
    <div>
      {/* 1 — Portfolio summary */}
      <div className="pb-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
          My Convictions
        </div>
        <div className="num mt-2 text-[22px] leading-none text-[var(--text)]">{usd(total)}</div>
        <div className="num mt-2 text-[11px] text-[var(--text-secondary)]">
          {signedUsd(deltaUsd)} · {signedPct(deltaPct)} today
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--border)" }} />

      {/* 2 — Position cards */}
      {!wallet ? (
        <div className="pt-4">
          <WalletConnectButton />
        </div>
      ) : positions.length === 0 ? (
        <div className="pt-4 text-[11px] text-[var(--text-muted)]">
          No open positions in the live markets yet.
        </div>
      ) : (
        <div className="flex flex-col gap-2 pt-4">
          {positions.map((p) => (
            <Link
              key={p.id}
              to="/market/$id"
              params={{ id: String(p.id) }}
              className="block rounded-[14px] p-3 transition-colors"
              style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
            >
              <div className="line-clamp-2 text-[13px] leading-snug text-[var(--text)]">
                {p.title}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span
                  className="rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide"
                  style={{
                    color: p.side === "YES" ? "var(--yes)" : "var(--no)",
                    background:
                      p.side === "YES"
                        ? "color-mix(in oklab, var(--yes) 16%, transparent)"
                        : "color-mix(in oklab, var(--no) 16%, transparent)",
                  }}
                >
                  {p.side}
                </span>
                <span className="num text-[12px] text-[var(--text)]">{usd(p.value)}</span>
                <span className="num text-[11px] text-[var(--text-secondary)]">
                  {signedPct(p.chg)}
                </span>
              </div>
              {p.pulse && (
                <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
                  <span
                    className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: "var(--text-muted)" }}
                  />
                  <span className="truncate">
                    {p.pulse.name ?? "someone"} {p.pulse.type === "reduced" ? "cut" : "joined"}{" "}
                    {p.pulse.side}
                  </span>
                  <span className="num ml-auto shrink-0">{ago(p.pulse.at)}</span>
                </div>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
