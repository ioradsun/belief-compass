/**
 * LEFT PANEL — "My Convictions".
 *
 * Presentation only: portfolio summary (neutral grey change line), then one
 * position card per open belief. Each card runs the SAME live pulse line as the
 * market cards (shared Face/pulseLine, same rotation cadence), and the same
 * window-scoped percentage. Green/red are reserved for the YES/NO pill.
 */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import {
  getWallet,
  listMarketPulses,
  type Pulse,
  type VolumeWindow,
} from "@/lib/markets.functions";
import { Face, pulseLine, type MarketRow } from "@/components/MarketCard";
import { WalletConnectButton } from "@/components/WalletConnect";
import { WalletIdentity } from "@/components/WalletIdentity";

const ROTATE_MS = 4500;

type Position = {
  onchain_id: number;
  stance_side: string | null;
  yes_shares: number | null;
  no_shares: number | null;
  markets?: { title?: string | null } | null;
  state?: {
    yes_price_usd: number | null;
    no_price_usd: number | null;
    chg_24h_yes: number | null;
    chg_24h_no: number | null;
  } | null;
  chg_window_yes?: number | null;
  chg_window_no?: number | null;
};

function usd(n: number) {
  const v = Math.abs(n);
  const s = v >= 1000 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : v.toFixed(0);
  return `${n < 0 ? "−" : ""}$${s}`;
}
function signedUsd(n: number) {
  return `${n < 0 ? "−" : "+"}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
function signedPct(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const d = abs > 0 && abs < 10 ? 1 : 0;
  return `${n < 0 ? "−" : "+"}${abs.toFixed(d)}%`;
}

/** One position card, with its own rotating pulse line. */
function PositionCard({
  p,
  ethUsd,
  stagger,
  winLabel,
}: {
  p: {
    id: number;
    side: "YES" | "NO";
    value: number;
    chg: number | null;
    title: string;
    pulses: Pulse[];
  };
  ethUsd: number;
  stagger: number;
  winLabel: string;
}) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (p.pulses.length <= 1) return;
    let interval: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      setI((n) => (n + 1) % p.pulses.length);
      interval = setInterval(() => setI((n) => (n + 1) % p.pulses.length), ROTATE_MS);
    }, stagger);
    return () => {
      clearTimeout(start);
      if (interval) clearInterval(interval);
    };
  }, [p.pulses.length, stagger]);

  const current = p.pulses[i % Math.max(1, p.pulses.length)];

  return (
    <Link
      to="/market/$id"
      params={{ id: String(p.id) }}
      className="block rounded-[14px] p-3 transition-colors"
      style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
    >
      <div className="line-clamp-2 text-[13px] leading-snug text-[var(--text)]">{p.title}</div>
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
          {signedPct(p.chg)} <span className="text-[var(--text-muted)]">{winLabel}</span>
        </span>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
        <span
          className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${current ? "animate-pulse" : ""}`}
          style={{ background: current ? "var(--yes)" : "var(--text-muted)" }}
        />
        {current ? (
          <>
            <Face p={current} size={16} />
            <span className="truncate">{pulseLine(current, ethUsd)}</span>
          </>
        ) : (
          <span className="truncate">quiet — no recent trades</span>
        )}
      </div>
    </Link>
  );
}

export function MyConvictions({
  wallet,
  rows,
  pulses,
  window: win = "24h",
  winLabel = "24H",
  ethUsd = 0,
}: {
  wallet?: string;
  rows: MarketRow[];
  pulses: Record<string, Pulse[]>;
  window?: VolumeWindow;
  winLabel?: string;
  ethUsd?: number;
}) {
  const { data } = useQuery({
    queryKey: ["my-convictions", wallet ?? null, win],
    queryFn: async () => await getWallet({ data: { wallet: wallet as string, window: win } }),
    enabled: !!wallet,
    refetchInterval: 30_000,
  });

  const byId = new Map<number, MarketRow>();
  for (const r of rows) byId.set(Number(r.onchain_id), r);

  const built = ((data?.positions ?? []) as Position[])
    .map((p) => {
      const id = Number(p.onchain_id);
      const m = byId.get(id);
      const st = p.state ?? null;
      const side = p.stance_side === "NO" ? "NO" : p.stance_side === "YES" ? "YES" : null;
      if (!side) return null;
      const shares = Number((side === "YES" ? p.yes_shares : p.no_shares) ?? 0);
      // Prefer the live feed row when the market is on screen, otherwise fall
      // back to market_state so held markets outside the feed page still show.
      const price = Number(
        (side === "YES" ? m?.yes_price_usd : m?.no_price_usd) ??
          (side === "YES" ? st?.yes_price_usd : st?.no_price_usd) ??
          0,
      );
      const value = shares * price;
      if (!(value > 0)) return null;
      const raw =
        (side === "YES" ? m?.chg_window_yes : m?.chg_window_no) ??
        (side === "YES" ? p.chg_window_yes : p.chg_window_no) ??
        null;
      const chg = raw == null || !Number.isFinite(Number(raw)) ? null : Number(raw);
      return {
        id,
        side,
        value,
        chg,
        title: p.markets?.title ?? `Market #${id}`,
      };
    })
    .filter(Boolean) as {
    id: number;
    side: "YES" | "NO";
    value: number;
    chg: number | null;
    title: string;
  }[];

  built.sort((a, b) => b.value - a.value);
  const top = built.slice(0, 40);

  // Same feed the market cards run on, but for the markets *I* hold — those are
  // mostly outside the 50-row feed page, so they need their own pulse fetch.
  const missing = top.map((p) => p.id).filter((id) => !pulses[String(id)]);
  const { data: mine } = useQuery({
    queryKey: ["my-pulses", missing.join(",")],
    queryFn: async () => await listMarketPulses({ data: { ids: missing.slice(0, 40) } }),
    enabled: missing.length > 0,
    refetchInterval: 20_000,
  });
  const minePulses = mine?.pulses ?? {};

  const positions = top.map((p) => ({
    ...p,
    pulses: pulses[String(p.id)] ?? minePulses[String(p.id)] ?? [],
  }));

  const total = built.reduce((s, p) => s + p.value, 0);
  const prev = built.reduce((s, p) => {
    const f = 1 + (p.chg ?? 0) / 100;
    return s + (f > 0 ? p.value / f : p.value);
  }, 0);
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
          {signedUsd(deltaUsd)} · {signedPct(deltaPct)} {winLabel.toLowerCase()}
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--border)" }} />

      {/* Vendor + POV wallet, with the link flow one tap away */}
      <WalletIdentity viewing={wallet ?? ""} compact />

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
          {positions.map((p, idx) => (
            <PositionCard
              key={p.id}
              p={p}
              ethUsd={ethUsd}
              stagger={(idx % 6) * 700}
              winLabel={winLabel}
            />
          ))}
        </div>
      )}
    </div>
  );
}
