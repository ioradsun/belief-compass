/**
 * LEFT PANEL — "Your Convictions". A dashboard of living beliefs, not a portfolio.
 *
 * Each card answers four questions at a glance: what do I believe (the question),
 * what side am I on (a badge), how is my conviction performing (worth + gain, not
 * cost), and — the reason to open the market today — how is it reacting (ONE
 * dynamic story + a personal Pulse). Cards are ranked by urgency, so a Twin/Tribe/
 * Opp arrival or a believer surge rises to the top; money is a consequence, never
 * the headline. Story selection, pulse and ranking come from the pure
 * src/domain/position-story engine. Clicking opens the market in the center.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { listLiveEvents } from "@/lib/live.functions";
import { getWallet, type VolumeWindow } from "@/lib/markets.functions";
import { type MarketRow } from "@/components/MarketCard";
import { positionPnl } from "@/domain/position";
import { positionReturn, formatPct } from "@/domain/metric-display";
import { formatMoney } from "@/domain/money";
import { StandOnIt } from "@/components/StandOnIt";
import { useDisplayUnit } from "@/lib/display-unit";
import {
  positionSignal,
  type PositionSignal,
  type PulseTone,
  type Side,
} from "@/domain/position-story";

type Position = {
  onchain_id: number;
  stance_side: string | null;
  yes_shares: number | null;
  no_shares: number | null;
  yes_cost?: number | null;
  no_cost?: number | null;
  markets?: { title?: string | null } | null;
  state?: {
    yes_price_usd: number | null;
    no_price_usd: number | null;
    chg_24h_yes: number | null;
    chg_24h_no: number | null;
    believers_yes?: number | null;
    believers_no?: number | null;
    new_believers_yes_24h?: number | null;
    new_believers_no_24h?: number | null;
  } | null;
  chg_window_yes?: number | null;
  chg_window_no?: number | null;
  new_believers_yes_win?: number | null;
  new_believers_no_win?: number | null;
  yes_value_usd?: number | null;
  no_value_usd?: number | null;
  /** The stored marked value is too old to trust as a live mark (see getWallet). */
  yes_value_stale?: boolean;
  no_value_stale?: boolean;
};

/** Formats a money amount, converting to the viewer's chosen unit (USD/ETH). */
type MoneyFmt = (n: number) => string;

/** The one accent colour a tone earns — green for strengthening, red for
 *  weakening, quiet otherwise. Typography carries the rest of the hierarchy. */
const toneColor = (t: PulseTone): string =>
  t === "up"
    ? "var(--yes)"
    : t === "down"
      ? "var(--no)"
      : t === "neutral"
        ? "var(--text-secondary)"
        : "var(--text-muted)";

type Built = {
  id: number;
  side: Side;
  value: number;
  gainUsd: number | null;
  /** Return on remaining cost basis (gain / invested × 100), null when no basis. */
  gainPct: number | null;
  /** Shares still held on this side. */
  shares: number;
  /** Average entry price per share (USD), null when no authoritative basis. */
  entryPrice: number | null;
  /** Live per-share price (USD), null when unpriced. */
  currentPrice: number | null;
  /** Change in marked value over the SELECTED window (null when unknown). */
  deltaUsd: number | null;
  /** What that delta is measured against — "24H", "1W" … or "since entered". */
  deltaLabel: string;
  title: string;
  believers: null | number;
  /** New believers on this side over the SELECTED window (null when unknown). */
  newInWindow: number | null;
  /** The window's short name, e.g. "24H" / "1W" — what newInWindow is measured over. */
  windowLabel: string;
  chg: number | null;
  signal: PositionSignal;
};

/**
 * One conviction card. Question → side → worth+gain → market believers → personal
 * Pulse → the one dynamic story. No invested amount, no giant %, no raw price.
 */
function ConvictionCard({
  p,
  onSelect,
  money,
  signedMoney,
}: {
  p: Built;
  onSelect: (id: number) => void;
  money: MoneyFmt;
  signedMoney: MoneyFmt;
}) {
  const sideColor = p.side === "YES" ? "var(--yes)" : "var(--no)";
  const { pulse, pulseTone, story } = p.signal;
  // The personal outcome, by the one rule: value leads, P&L is the answer, the
  // return % is paired to it. Never a market price %. Null → no trusted cost basis.
  const ret = positionReturn({
    gainUsd: p.gainUsd,
    gainPct: p.gainPct,
    money: (v, signed) => (signed ? signedMoney(v) : money(v)),
  });
  const sharesLabel = p.shares.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(p.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(p.id);
        }
      }}
      className="block w-full cursor-pointer rounded-[14px] p-3.5 text-left transition-colors hover:bg-[var(--surface-2)]"
      style={{ background: "var(--surface)" }}
    >
      {/* 1 — What do I believe? (largest). pr-9 reserves the corner for the
        always-present "Stand on it" share control layered above the card. */}
      <div className="pr-9 text-[14px] font-semibold leading-snug text-[var(--text)]">
        {p.title}
      </div>

      {/* 2 — What side am I on? */}
      <div className="mt-2">
        <span
          className="rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide"
          style={{ color: sideColor, background: "var(--surface-2)" }}
        >
          {p.side}
        </span>
      </div>

      {/* 3 — How am I doing? Position value leads, then P&L · return% (the answer),
        then the supporting facts (shares · entry → now). "Marked value" = shares ×
        current price; the realizable amount on exit is quoted in the sell ticket.
        With no trusted cost basis we fall back to the selected window's move. */}
      <div className="mt-2.5 flex items-baseline gap-2">
        <span className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
          Marked value
        </span>
        <span className="num text-[20px] font-semibold leading-none text-[var(--text)]">
          {money(p.value)}
        </span>
        {!ret &&
          p.deltaUsd != null &&
          (Math.abs(p.deltaUsd) >= 0.005 ? (
            <span
              className="num ml-auto text-[12px] font-semibold"
              style={{ color: p.deltaUsd > 0 ? "var(--yes)" : "var(--no)" }}
            >
              {signedMoney(p.deltaUsd)}
              <span className="ml-1 text-[10px] font-normal text-[var(--text-muted)]">
                {p.deltaLabel}
              </span>
            </span>
          ) : (
            <span className="ml-auto text-[11px] font-normal text-[var(--text-muted)]">
              No change
            </span>
          ))}
      </div>

      {/* P&L · return% — the pair that answers "what did I make?" */}
      {ret && (
        <div className="mt-1.5 flex items-baseline gap-1.5">
          <span
            className="num text-[13px] font-semibold"
            style={{
              color:
                ret.direction === "up"
                  ? "var(--yes)"
                  : ret.direction === "down"
                    ? "var(--no)"
                    : "var(--text-secondary)",
            }}
          >
            {ret.pnl}
            {ret.pct && <span className="ml-1">· {ret.pct}</span>}
          </span>
          <span className="text-[10px] font-normal text-[var(--text-muted)]">your return</span>
        </div>
      )}

      {/* Supporting facts — quiet, one line: efficiency of the outcome. */}
      {p.entryPrice != null && p.currentPrice != null && p.shares > 0 && (
        <div className="num mt-1 text-[10px] text-[var(--text-muted)]">
          {sharesLabel} {p.side} share{p.shares === 1 ? "" : "s"} · entry {money(p.entryPrice)} →
          now {money(p.currentPrice)}
        </div>
      )}

      {/* 4 — How is the market reacting? Believers (scale + movement), then Pulse. */}
      {p.believers != null && p.believers > 0 && (
        <>
          <Divider />
          <div className="flex items-baseline gap-2">
            <span className="num text-[13px] font-semibold text-[var(--text)]">
              {p.believers.toLocaleString("en-US")}
            </span>
            <span className="text-[11px] text-[var(--text-muted)]">Market Believers</span>
            {p.newInWindow != null && p.newInWindow > 0 && (
              <span className="num ml-auto text-[11px] font-semibold text-[var(--yes)]">
                +{p.newInWindow.toLocaleString("en-US")}
                {p.believers != null && p.believers - p.newInWindow > 0
                  ? ` (+${Math.round((p.newInWindow / (p.believers - p.newInWindow)) * 100)}%)`
                  : ""}
                <span className="ml-1 font-normal text-[var(--text-muted)]">{p.windowLabel}</span>
              </span>
            )}
          </div>
        </>
      )}

      <Divider />
      <div className="flex items-baseline gap-2">
        <span className="text-[10px] uppercase tracking-[0.12em] text-[var(--text-muted)]">
          Pulse
        </span>
        <span className="text-[12px] font-semibold" style={{ color: toneColor(pulseTone) }}>
          {pulse}
        </span>
      </div>

      {/* The one dynamic story — the reason to open this market today. */}
      <Divider />
      <div className="text-[12px] leading-snug text-[var(--text-secondary)]">{story.headline}</div>
      {story.body && (
        <div className="mt-0.5 text-[11px] leading-snug text-[var(--text-muted)]">{story.body}</div>
      )}
    </button>
  );
}

const Divider = () => <div className="my-2.5" style={{ borderTop: "1px solid var(--hairline)" }} />;

export function MyConvictions({
  wallet,
  rows,
  window: win = "24h",
  winLabel = "24H",
  ethUsd = 0,
  onSelect,
  onExplore,
  onCount,
}: {
  wallet?: string;
  rows: MarketRow[];
  window?: VolumeWindow;
  winLabel?: string;
  /** Live ETH/USD rate — needed to render money in the viewer's chosen unit. */
  ethUsd?: number;
  onSelect: (id: number) => void;
  /** Empty-state CTA — take me to the markets. */
  onExplore?: () => void;
  /** Reports the number of live convictions to the tab strip. */
  onCount?: (n: number) => void;
}) {
  const { unit } = useDisplayUnit();
  // Position value and gain are USD-native (POV marks the tokens in dollars); one
  // rate takes them to the viewer's chosen unit so both sides share a rate.
  const money: MoneyFmt = (n) => formatMoney(n, { from: "USD", to: unit, ethUsd });
  const signedMoney: MoneyFmt = (n) =>
    formatMoney(n, { from: "USD", to: unit, ethUsd, signed: true });

  const { data } = useQuery({
    queryKey: ["my-convictions", wallet ?? null, win],
    queryFn: async () => await getWallet({ data: { wallet: wallet as string, window: win } }),
    enabled: !!wallet,
    // usePositionStream refetches this the moment the viewer's beliefs change;
    // the interval is now a slow safety reconcile (POV worth also drifts with
    // price between belief changes, so a periodic re-value is still healthy).
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });

  const byId = new Map<number, MarketRow>();
  for (const r of rows) byId.set(Number(r.onchain_id), r);

  // First pass: the honest ownership facts per held side (no story yet).
  const facts = ((data?.positions ?? []) as Position[])
    .map((p) => {
      const id = Number(p.onchain_id);
      const m = byId.get(id);
      const st = p.state ?? null;
      const side: Side | null =
        p.stance_side === "NO" ? "NO" : p.stance_side === "YES" ? "YES" : null;
      if (!side) return null;
      const shares = Number((side === "YES" ? p.yes_shares : p.no_shares) ?? 0);
      const price = Number(
        (side === "YES" ? m?.yes_price_usd : m?.no_price_usd) ??
          (side === "YES" ? st?.yes_price_usd : st?.no_price_usd) ??
          0,
      );
      // A stale marked value is not trusted as a live mark: fall through to a
      // fresh shares×price mark instead, so worth stays current and any gain is
      // never a stale value minus a fresh cost basis.
      const stale = side === "YES" ? p.yes_value_stale : p.no_value_stale;
      const reported = side === "YES" ? p.yes_value_usd : p.no_value_usd;
      const marked =
        !stale && reported != null && Number.isFinite(Number(reported)) && Number(reported) > 0;
      const value = marked ? Number(reported) : shares * price;
      if (!(value > 0)) return null;
      const rawChg =
        (side === "YES" ? m?.chg_window_yes : m?.chg_window_no) ??
        (side === "YES" ? p.chg_window_yes : p.chg_window_no) ??
        null;
      const chg = rawChg == null || !Number.isFinite(Number(rawChg)) ? null : Number(rawChg);
      const believersRaw =
        (side === "YES" ? st?.believers_yes : st?.believers_no) ??
        (side === "YES" ? m?.believers_yes : m?.believers_no) ??
        null;
      const newTodayRaw =
        (side === "YES" ? st?.new_believers_yes_24h : st?.new_believers_no_24h) ?? null;
      // Intake over the SELECTED window (server-replayed); on 24h the read-model
      // number is the same measure, so it's the natural fallback.
      const newWinRaw =
        (side === "YES" ? p.new_believers_yes_win : p.new_believers_no_win) ??
        (win === "24h" ? newTodayRaw : null);
      const invested = side === "YES" ? p.yes_cost : p.no_cost;
      const pnl = positionPnl({ invested, worth: value });
      // Average entry = remaining cost basis ÷ shares still held (both authoritative);
      // null unless we can quote it honestly. Current price is the live per-share mark.
      const entryPrice = pnl.investedUsd != null && shares > 0 ? pnl.investedUsd / shares : null;
      return {
        id,
        side,
        value,
        chg,
        invested: pnl.investedUsd,
        gainUsd: pnl.gainUsd,
        gainPct: pnl.gainPct,
        shares,
        entryPrice,
        currentPrice: price > 0 ? price : null,
        title: p.markets?.title ?? `Market #${id}`,
        believers: believersRaw == null ? null : Number(believersRaw),
        newToday: newTodayRaw == null ? null : Number(newTodayRaw),
        newInWindow: newWinRaw == null ? null : Number(newWinRaw),
      };
    })
    .filter(Boolean) as {
    id: number;
    side: Side;
    value: number;
    chg: number | null;
    invested: number | null;
    gainUsd: number | null;
    gainPct: number | null;
    shares: number;
    entryPrice: number | null;
    currentPrice: number | null;
    title: string;
    believers: number | null;
    newToday: number | null;
    newInWindow: number | null;
  }[];

  // Per-market network signal: pass the wallet so the tape tags Twin/Tribe/Opp and
  // milestones, side-blind. These lift a card to the top when your people arrive.
  const tapeIds = facts.slice(0, 40).map((f) => f.id);
  const { data: tape } = useQuery({
    queryKey: ["positions-tape", wallet ?? null, [...tapeIds].sort((a, b) => a - b)],
    queryFn: () => listLiveEvents({ data: { wallet, marketIds: tapeIds, limit: 120 } }),
    enabled: tapeIds.length > 0,
    // The events stream refetches this the moment one of these markets trades;
    // the interval is now a slow safety reconcile.
    refetchInterval: 30_000,
    placeholderData: (prev) => prev,
  });
  const netByMarket = new Map<
    number,
    { twin?: boolean; tribe?: boolean; opp?: boolean; milestone?: number | null }
  >();
  for (const r of tape?.rows ?? []) {
    const id = Number(r.marketId);
    const cur = netByMarket.get(id) ?? {};
    const cat = r.story?.category;
    if (cat === "twin") cur.twin = true;
    else if (cat === "tribe") cur.tribe = true;
    else if (cat === "opp") cur.opp = true;
    if (r.kind === "believer_milestone") {
      const th = Number((r.payload as { threshold?: unknown } | null)?.threshold ?? 0);
      if (th > 0) cur.milestone = th;
    }
    netByMarket.set(id, cur);
  }

  // The delta always answers "over the period you selected". For a finite window
  // that's the mark-to-mark move (value now − value at the start of the window,
  // implied by the window price change). For "All" the honest starting point IS
  // your purchase price, so it falls back to gain vs cost basis.
  const lifetime = win === "all";
  const deltaLabel = lifetime ? "since entered" : winLabel.toUpperCase();
  const windowDelta = (value: number, chg: number | null): number | null => {
    if (chg == null) return null;
    const f = 1 + chg / 100;
    if (!(f > 0)) return null;
    return value - value / f;
  };

  // Second pass: attach the story + pulse, then rank by urgency.
  const built: Built[] = facts.map((f) => {
    const net = netByMarket.get(f.id);
    const signal = positionSignal(
      {
        side: f.side,
        believers: f.believers,
        newToday: f.newToday,
        gainUsd: f.gainUsd,
        chgPct: f.chg,
        net,
        milestone: net?.milestone ?? null,
      },
      (n) => money(n),
    );
    return {
      id: f.id,
      side: f.side,
      value: f.value,
      gainUsd: f.gainUsd,
      gainPct: f.gainPct,
      shares: f.shares,
      entryPrice: f.entryPrice,
      currentPrice: f.currentPrice,
      deltaUsd: lifetime ? f.gainUsd : windowDelta(f.value, f.chg),
      deltaLabel,
      title: f.title,
      believers: f.believers,
      newInWindow: f.newInWindow,
      windowLabel: lifetime ? "all time" : winLabel.toUpperCase(),
      chg: f.chg,
      signal,
    };
  });

  // Rank by "what's alive": urgency first, then the size of the move, then scale.
  built.sort(
    (a, b) =>
      b.signal.urgency - a.signal.urgency ||
      Math.abs(b.deltaUsd ?? 0) - Math.abs(a.deltaUsd ?? 0) ||
      (b.believers ?? 0) - (a.believers ?? 0) ||
      b.value - a.value,
  );
  const positions = built.slice(0, 40);

  const total = built.reduce((s, p) => s + p.value, 0);

  // Summary mirrors the cards: the selected period's move, or — on "All" — the
  // authoritative unrealized gain when every position has a real cost basis.
  const fullBasis = built.length > 0 && built.every((p) => p.gainUsd != null);
  const trueGain = lifetime && fullBasis ? built.reduce((s, p) => s + (p.gainUsd ?? 0), 0) : null;
  const periodUsd = built.reduce((s, p) => s + (windowDelta(p.value, p.chg) ?? 0), 0);

  const count = built.length;
  useEffect(() => {
    onCount?.(count);
  }, [count, onCount]);

  if (!wallet || built.length === 0) {
    return <EmptyState onExplore={onExplore} />;
  }

  return (
    <div>
      {/* Summary — one financial story, money only. */}
      <div className="pb-4">
        <div className="mt-2.5 text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
          Marked value
        </div>
        <div className="num text-[24px] leading-none text-[var(--text)]">{money(total)}</div>
        {trueGain != null && Math.abs(trueGain) >= 0.005 ? (
          <div
            className="num mt-1.5 text-[12px] font-semibold"
            style={{ color: trueGain > 0 ? "var(--yes)" : "var(--no)" }}
          >
            {signedMoney(trueGain)}
            {(() => {
              // Aggregate return on the pooled cost basis (total − gain), paired to
              // the dollar P&L just like each card.
              const invested = total - trueGain;
              const pct =
                invested > 0 ? formatPct((trueGain / invested) * 100, { precise: true }) : null;
              return pct ? <span> · {pct}</span> : null;
            })()}{" "}
            <span className="font-normal text-[var(--text-muted)]">since you started</span>
          </div>
        ) : Math.abs(periodUsd) >= 0.01 ? (
          <div
            className="num mt-1.5 text-[12px] font-semibold"
            style={{ color: periodUsd > 0 ? "var(--yes)" : "var(--no)" }}
          >
            {signedMoney(periodUsd)}{" "}
            <span className="font-normal text-[var(--text-muted)]">{winLabel.toLowerCase()}</span>
          </div>
        ) : (
          <div className="mt-1.5 text-[11px] font-normal text-[var(--text-muted)]">No change</div>
        )}
      </div>

      <div style={{ borderTop: "1px solid var(--hairline)" }} />

      <div className="flex flex-col gap-2.5 pt-4">
        {positions.map((p) => (
          // The share control is a sibling of the card button (never nested — a
          // button inside a button is invalid), pinned to the corner.
          <div key={p.id} className="relative">
            <ConvictionCard p={p} onSelect={onSelect} money={money} signedMoney={signedMoney} />
            <div className="absolute right-2.5 top-3">
              <StandOnIt variant="card" marketId={p.id} title={p.title} side={p.side} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** No convictions yet — an invitation, not an empty portfolio. */
function EmptyState({ onExplore }: { onExplore?: () => void }) {
  return (
    <div className="pt-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
        Your Convictions
      </div>
      <div className="mt-3 text-[15px] font-semibold text-[var(--text)]">
        Back your first belief.
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-muted)]">
        The House can&rsquo;t discover your Tribe until you start expressing conviction.
      </p>
      {onExplore && (
        <button
          type="button"
          onClick={onExplore}
          className="mt-4 rounded-[10px] px-3.5 py-2 text-[12px] font-semibold text-[var(--bg)] transition-transform active:scale-[0.98] motion-reduce:active:scale-100"
          style={{ background: "var(--text)" }}
        >
          Explore Markets
        </button>
      )}
    </div>
  );
}
