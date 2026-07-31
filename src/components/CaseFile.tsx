/**
 * Case File — information architecture only.
 *
 * One side of the market's case (YES or NO), assembled ENTIRELY from intelligence
 * that already exists elsewhere in the app. Nothing here is calculated, fetched
 * fresh, or invented: it reuses the exact same React Query keys the deck already
 * runs (so no duplicate requests), reuses the existing per-side renderers
 * (SideColumn / DefenseColumn from MarketEvidence), and reads the side-specific
 * capital + price move straight off the market row the center already has.
 *
 * Layout is identical on both sides so YES (left) and NO (right) read as two
 * halves of one case: a FIXED comparative summary (Capital · People · Money ·
 * Move) pinned at the top — same height both sides so the numbers line up across
 * the center — then the deeper People → Your Network → Evidence scrolls below.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMarketEvidence } from "@/lib/evidence.functions";
import { getNetwork } from "@/lib/dna.functions";
import { getMarketChange } from "@/lib/markets.functions";
import { SideColumn, DefenseColumn } from "@/components/MarketEvidence";
import { ConvictionTimeline } from "@/components/ConvictionTimeline";
import type { MarketRow } from "@/components/MarketCard";
import { fmtUsd } from "@/domain/order";
import { hueFor, initialsFor } from "@/lib/wallet-identity";
import { convictionSeries, timelineEvents, leadStory } from "@/domain/conviction-series";
import { FLOW_WINDOW_SHORT } from "@/domain/market-flow";
import { useDeckWindow } from "@/lib/deck-window";

type Side = "YES" | "NO";

/** The one investigation section open at a time — SHARED across both columns. */
export type CaseSection = "people" | "network" | "evidence";

/** Existing relationship labels → the case's language (no new metrics). */
const REL_LABEL: Record<string, string> = {
  twin: "Twin",
  tribe: "Tribe",
  opp: "Rival",
  inverse: "Inverse",
  neutral: "Match",
};

/**
 * One collapsible investigation section. The open/closed state is OWNED by the
 * parent (index.tsx) and shared with the opposite column, so YES and NO always
 * show the same section — you only ever compare like with like. Height animates
 * via the grid-template-rows 0fr→1fr trick (CSS-only, ~200ms, no measurement).
 */
function AccordionSection({
  id,
  title,
  count,
  open,
  onToggle,
  children,
}: {
  id: CaseSection;
  title: string;
  count?: number | null;
  open: boolean;
  onToggle: (s: CaseSection) => void;
  children: React.ReactNode;
}) {
  return (
    <section>
      <button
        type="button"
        onClick={() => onToggle(id)}
        aria-expanded={open}
        className="flex w-full items-center justify-between rounded-[8px] px-0.5 py-1.5 text-left transition-colors hover:bg-[var(--surface-2,var(--border))]"
      >
        <span className="flex items-center gap-1.5">
          <svg
            aria-hidden
            viewBox="0 0 24 24"
            className="h-3 w-3 shrink-0 text-[var(--text-muted)] transition-transform duration-200 ease-out motion-reduce:transition-none"
            style={{ transform: open ? "rotate(90deg)" : "none" }}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
          >
            <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
            {title}
          </span>
        </span>
        {count != null && <span className="num text-[10px] text-[var(--text-muted)]">{count}</span>}
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none"
        style={{ gridTemplateRows: open ? "1fr" : "0fr" }}
      >
        <div className="overflow-hidden">
          <div className="pt-1.5">{children}</div>
        </div>
      </div>
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
  ethUsd = 0,
  openSection,
  onToggleSection,
}: {
  side: Side;
  marketId: number;
  row: MarketRow;
  viewerWallet?: string;
  /** Live ETH/USD, so the event rail speaks dollars like the rest of the app. */
  ethUsd?: number;
  /** The section open on BOTH columns (shared parent state); null = all collapsed. */
  openSection: CaseSection | null;
  onToggleSection: (s: CaseSection) => void;
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

  // The deck already runs this exact key for its own price/flow numbers, so the
  // timeline is free: same response, rebuilt locally per window.
  const { data: change } = useQuery({
    queryKey: ["market-change", marketId],
    queryFn: () => getMarketChange({ data: { id: marketId } }),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  // The window the trader picked in the center — never a second period on screen.
  const win = useDeckWindow();
  const tape = change?.tape;
  const { series, events, caption } = useMemo(() => {
    if (!tape?.length) return { series: [], events: [], caption: null };
    const now = Date.now();
    const s = convictionSeries(tape, side, win, now);
    return {
      series: s,
      events: timelineEvents(tape, side, win, now, 10),
      caption: leadStory(s),
    };
  }, [tape, side, win]);

  const relByWallet = new Map((net?.people ?? []).map((p) => [p.wallet.toLowerCase(), p]));
  const networkWallets = new Set(relByWallet.keys());


  const believers = (evidence?.believers ?? []).filter((b) => b.side === side);
  const defense = (evidence?.defense ?? []).filter((o) => o.vote === side);

  // Your network on THIS side — existing believers ∩ existing matches, labeled
  // with their existing relationship. No new relationship is computed.
  const networkHere = believers
    .filter((b) => networkWallets.has(b.wallet.toLowerCase()))
    .map((b) => ({ believer: b, person: relByWallet.get(b.wallet.toLowerCase())! }));

  // Comparative summary — all genuinely SIDE-SPECIFIC fields, straight off the
  // market row the center already holds. (Deliberately NOT new_believers_24h or
  // live_line: those are market-wide on the row, not per side — showing them under
  // one side would misrepresent shared activity as directional evidence.)
  const rr = row as Record<string, unknown>;
  const capital = num(side === "YES" ? rr.yes_capital_usd : rr.no_capital_usd);
  const believersCount = num(side === "YES" ? rr.believers_yes : rr.believers_no);
  const moneyYes = num(rr.money_yes_pct);
  const moneySide = moneyYes == null ? null : side === "YES" ? moneyYes : 100 - moneyYes;
  const chg =
    num(side === "YES" ? rr.chg_window_yes : rr.chg_window_no) ??
    num(side === "YES" ? rr.chg_24h_yes : rr.chg_24h_no);
  // Per-share price belongs HERE (the detailed view), not on the calm center
  // card — a small factual item, never the headline.
  const price = num(side === "YES" ? rr.yes_price_usd : rr.no_price_usd);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-[13px] font-semibold" style={{ color }}>
          {side}
        </span>
        <span className="text-[13px] font-semibold text-[var(--text)]">Case</span>
      </div>

      {/* Fixed comparative summary — the highest-level side facts (Capital · People
        · Money · Move). Every stat always renders (— when absent) so the YES and NO
        summaries are the SAME height and line up across the center. Calm by design:
        a neutral hairline + faint side tint carry column identity (not a heavy
        colored box), and the stats sit on open space, not nested tiles. */}
      <div
        className="mb-4 shrink-0 rounded-[12px] p-3"
        style={{
          border: "1px solid var(--border)",
          background: `color-mix(in oklab, ${color} 4%, transparent)`,
        }}
      >
        <div className="flex items-end justify-between">
          <span className="text-[11px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
            Capital
          </span>
          <span className="num text-[22px] font-semibold leading-none text-[var(--text)]">
            {capital != null ? fmtUsd(capital) : "—"}
          </span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <SummaryStat
            label="People"
            value={believersCount != null ? String(believersCount) : "—"}
          />
          <SummaryStat label="Money" value={moneySide != null ? `${moneySide.toFixed(0)}%` : "—"} />
          <SummaryStat
            label="Move"
            value={
              chg != null
                ? `${chg > 0 ? "▲" : chg < 0 ? "▼" : "•"} ${Math.abs(chg).toFixed(1)}%`
                : "—"
            }
            color={
              chg == null ? undefined : chg > 0 ? "var(--yes)" : chg < 0 ? "var(--no)" : undefined
            }
          />
        </div>
        {/* Execution detail — the raw per-share price, quietly, for the record. */}
        <div
          className="mt-3 flex items-baseline justify-between border-t pt-2 text-[10px] text-[var(--text-muted)]"
          style={{ borderColor: "var(--border)" }}
        >
          <span className="uppercase tracking-[0.1em]">Share price</span>
          <span className="num">{price != null ? `$${price.toFixed(2)}` : "—"}</span>
        </div>
      </div>

      {/* Investigation sections — collapsed by default; exactly one open, the SAME
        one on both columns (parent-owned openSection). People vs People, etc. */}
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
        {/* People — reuse the deck's own per-side believer list. */}
        <AccordionSection
          id="people"
          title="People"
          count={believers.length}
          open={openSection === "people"}
          onToggle={onToggleSection}
        >
          {believers.length === 0 ? (
            <Muted>No one on this side yet.</Muted>
          ) : (
            <SideColumn side={side} people={believers} networkWallets={networkWallets} />
          )}
        </AccordionSection>

        {/* Your Network — existing matches who back this side. */}
        <AccordionSection
          id="network"
          title="Your Network"
          count={networkHere.length || null}
          open={openSection === "network"}
          onToggle={onToggleSection}
        >
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
                  <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--text-muted)]">
                    {REL_LABEL[p.relationship] ?? p.relationship}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </AccordionSection>

        {/* Evidence — reuse the deck's own per-side Defense case. */}
        <AccordionSection
          id="evidence"
          title="Evidence"
          count={defense.length || null}
          open={openSection === "evidence"}
          onToggle={onToggleSection}
        >
          {defense.length === 0 ? (
            <Muted>No case made for {side} yet.</Muted>
          ) : (
            <DefenseColumn side={side} opinions={defense} />
          )}
        </AccordionSection>
      </div>
    </div>
  );
}

function SummaryStat({ label, value, color }: { label: string; value: string; color?: string }) {
  // Flat: value sits on open space (no nested tile), label recedes (small, muted,
  // not bold). Strong color only when `color` is passed (Move direction) — the
  // rest reads through contrast, so nothing decorative competes for the eye.
  return (
    <div>
      <div className="num text-[14px] font-semibold" style={{ color: color ?? "var(--text)" }}>
        {value}
      </div>
      <div className="mt-1 text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
        {label}
      </div>
    </div>
  );
}
