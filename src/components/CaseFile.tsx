/**
 * Case File — information architecture only.
 *
 * One side of the market's case (YES or NO), assembled ENTIRELY from intelligence
 * that already exists elsewhere in the app. Nothing here is calculated, fetched
 * fresh, or invented: it reuses the exact same React Query keys the deck already
 * runs (so no duplicate requests), reuses the existing per-side renderers
 * (SideColumn / DefenseColumn from MarketEvidence), and reads capital + momentum
 * straight off the market row the center already has.
 *
 * The columns are ordered identically on both sides — People → Your Network →
 * Capital → Momentum → Evidence — so YES (left) and NO (right) read as two halves
 * of the same case.
 */
import { useQuery } from "@tanstack/react-query";
import { getMarketEvidence } from "@/lib/evidence.functions";
import { getNetwork } from "@/lib/dna.functions";
import { SideColumn, DefenseColumn } from "@/components/MarketEvidence";
import type { MarketRow } from "@/components/MarketCard";
import { fmtUsd } from "@/domain/order";
import { hueFor, initialsFor } from "@/lib/wallet-identity";

type Side = "YES" | "NO";

/** Existing relationship labels → the case's language (no new metrics). */
const REL_LABEL: Record<string, string> = {
  twin: "Twin",
  tribe: "Tribe",
  opp: "Rival",
  inverse: "Inverse",
  neutral: "Match",
};

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number | null;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-baseline justify-between px-0.5">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
          {title}
        </h3>
        {count != null && <span className="num text-[10px] text-[var(--text-muted)]">{count}</span>}
      </div>
      {children}
    </section>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="px-0.5 text-[11px] text-[var(--text-muted)]">{children}</p>;
}

const num = (v: unknown): number | null =>
  v == null || !Number.isFinite(Number(v)) ? null : Number(v);

export function CaseColumn({
  side,
  marketId,
  row,
  viewerWallet,
}: {
  side: Side;
  marketId: number;
  row: MarketRow;
  viewerWallet?: string;
}) {
  const color = side === "YES" ? "var(--yes)" : "var(--no)";

  // Same queries the deck's intelligence panel already runs — React Query dedupes
  // by key, so opening the Case File adds no requests.
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

  const relByWallet = new Map((net?.people ?? []).map((p) => [p.wallet.toLowerCase(), p]));
  const networkWallets = new Set(relByWallet.keys());

  const believers = (evidence?.believers ?? []).filter((b) => b.side === side);
  const defense = (evidence?.defense ?? []).filter((o) => o.vote === side);

  // Your network on THIS side — existing believers ∩ existing matches, labeled
  // with their existing relationship. No new relationship is computed.
  const networkHere = believers
    .filter((b) => networkWallets.has(b.wallet.toLowerCase()))
    .map((b) => ({ believer: b, person: relByWallet.get(b.wallet.toLowerCase())! }));

  // Capital + momentum — straight off the market row the center already holds.
  const rr = row as Record<string, unknown>;
  const capital = num(side === "YES" ? rr.yes_capital_usd : rr.no_capital_usd);
  const believersCount = num(side === "YES" ? rr.believers_yes : rr.believers_no);
  const moneyYes = num(rr.money_yes_pct);
  const moneySide = moneyYes == null ? null : side === "YES" ? moneyYes : 100 - moneyYes;
  const chg =
    num(side === "YES" ? rr.chg_window_yes : rr.chg_window_no) ??
    num(side === "YES" ? rr.chg_24h_yes : rr.chg_24h_no);
  const newBackers24h = num(rr.new_believers_24h);
  const liveLine = (rr.live_line as string | null) ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-[13px] font-semibold" style={{ color }}>
          {side}
        </span>
        <span className="text-[13px] font-semibold text-[var(--text)]">Case</span>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-0.5">
        {/* 1. People — reuse the deck's own per-side believer list. */}
        <Section title="People" count={believers.length}>
          {believers.length === 0 ? (
            <Muted>No one on this side yet.</Muted>
          ) : (
            <SideColumn side={side} people={believers} networkWallets={networkWallets} />
          )}
        </Section>

        {/* 2. Your Network — existing matches who back this side. */}
        <Section title="Your Network" count={networkHere.length || null}>
          {!viewerWallet ? (
            <Muted>Connect a wallet to see who in your network is here.</Muted>
          ) : networkHere.length === 0 ? (
            <Muted>No one from your network backs {side} yet.</Muted>
          ) : (
            <ul className="space-y-0.5">
              {networkHere.map(({ believer: b, person: p }) => (
                <li key={b.wallet} className="flex items-center gap-1.5 rounded-[8px] px-1 py-1">
                  {p.avatarUrl ? (
                    <img src={p.avatarUrl} alt="" className="h-5 w-5 rounded-full object-cover" />
                  ) : (
                    <span
                      className="grid h-5 w-5 place-items-center rounded-full text-[8px] font-semibold text-white"
                      style={{ background: `hsl(${hueFor(b.wallet)} 45% 45%)` }}
                      aria-hidden
                    >
                      {initialsFor(p.displayName)}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--text)]">
                    {p.displayName}
                  </span>
                  <span className="text-[10px] font-semibold" style={{ color }}>
                    {REL_LABEL[p.relationship] ?? p.relationship}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* 3. Capital — existing side liquidity + money split off the row. */}
        <Section title="Capital">
          <div className="space-y-1 px-0.5 text-[12px]">
            <div className="flex items-baseline justify-between">
              <span className="text-[var(--text-muted)]">On this side</span>
              <span className="num text-[var(--text)]">
                {capital != null ? fmtUsd(capital) : "—"}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-[var(--text-muted)]">Believers</span>
              <span className="num text-[var(--text)]">{believersCount ?? "—"}</span>
            </div>
            {moneySide != null && (
              <div className="flex items-baseline justify-between">
                <span className="text-[var(--text-muted)]">Share of money</span>
                <span className="num" style={{ color }}>
                  {moneySide.toFixed(0)}%
                </span>
              </div>
            )}
          </div>
        </Section>

        {/* 4. Momentum — existing side price move + recent activity off the row. */}
        <Section title="Momentum">
          <div className="space-y-1 px-0.5 text-[12px]">
            <div className="flex items-baseline justify-between">
              <span className="text-[var(--text-muted)]">Price move</span>
              {chg != null ? (
                <span
                  className="num font-semibold"
                  style={{
                    color: chg > 0 ? "var(--yes)" : chg < 0 ? "var(--no)" : "var(--text-muted)",
                  }}
                >
                  {chg > 0 ? "▲" : chg < 0 ? "▼" : "•"} {Math.abs(chg).toFixed(1)}%
                </span>
              ) : (
                <span className="num text-[var(--text-muted)]">—</span>
              )}
            </div>
            {newBackers24h != null && newBackers24h > 0 && (
              <div className="flex items-baseline justify-between">
                <span className="text-[var(--text-muted)]">New believers · 24h</span>
                <span className="num text-[var(--text)]">{newBackers24h}</span>
              </div>
            )}
            {liveLine && (
              <p className="pt-0.5 text-[11px] leading-snug text-[var(--text-secondary)]">
                {liveLine}
              </p>
            )}
          </div>
        </Section>

        {/* 5. Evidence — reuse the deck's own per-side Defense case. */}
        <Section title="Evidence" count={defense.length || null}>
          {defense.length === 0 ? (
            <Muted>No case made for {side} yet.</Muted>
          ) : (
            <DefenseColumn side={side} opinions={defense} />
          )}
        </Section>
      </div>
    </div>
  );
}
