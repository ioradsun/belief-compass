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
import { type VolumeWindow } from "@/lib/markets.functions";
import { positionValueUsd } from "@/domain/position-value";
import { myConvictionsQO } from "@/lib/positions-query";
import { type MarketRow } from "@/components/MarketCard";
import { positionPnl } from "@/domain/position";
import { positionReturn, formatPct } from "@/domain/metric-display";
import { formatMoney } from "@/domain/money";
import { StandOnIt } from "@/components/StandOnIt";
import { useDisplayUnit } from "@/lib/display-unit";
import {
  positionSignal,
  type CanonicalLine,
  type PositionSignal,
  type Side,
} from "@/domain/position-story";
import { marketTitle } from "@/domain/market-title";

type Position = {
  onchain_id: number;
  yes_shares: number | null;
  no_shares: number | null;
  yes_cost?: number | null;
  no_cost?: number | null;
  markets?: { title?: string | null } | null;
  state?: {
    yes_price_usd: number | null;
    no_price_usd: number | null;
    believers_yes?: number | null;
    believers_no?: number | null;
    new_believers_yes_24h?: number | null;
    new_believers_no_24h?: number | null;
    /** The CANONICAL market narrative (read model) — re-told, never recomputed. */
    live_line?: string | null;
    live_line_kind?: string | null;
    live_line_window?: string | null;
    live_line_occurred_at?: string | null;
    live_line_payload?: {
      side?: string | null;
      wallets?: number | null;
      milestone?: number | null;
      crossed?: string | null;
      sell_rate?: number | null;
    } | null;
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

/** The pulse is a state of the market, not a gain or a loss — it stays neutral.
 *  Weight, not colour, carries its emphasis. */

type Built = {
  /** `${marketId}-${side}` — a market held on both sides is TWO positions. */
  key: string;
  id: number;
  side: Side;
  /** The other side of this market is held too — so two cards is not a duplicate. */
  paired: boolean;
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
 * ONE CONVICTION, ONE STORY.
 *
 * The card answers, in order: what do I believe (the question) → what is
 * happening to my side (one plain sentence) → where do I stand (side, what it is
 * worth, what it has done). Nothing else earns space:
 *
 *  • Pulse label — removed. "Accelerating / Capital-led" is a classification the
 *    reader has to decode, and the story sentence already says it in words.
 *  • Believers row — removed. The story sentence carries the count when it is the
 *    news; a standing number with no movement is not a reason to look.
 *  • Shares and entry → now — removed. Neither changes a decision; the worth and
 *    the return already state the outcome, and this is a belief, not a brokerage.
 *  • Dividers — removed. Spacing separates; lines only add noise.
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
  const { story } = p.signal;
  // The personal outcome, by the one rule: value leads, P&L is the answer, the
  // return % is paired to it. Never a market price %. Null → no trusted cost basis.
  const ret = positionReturn({
    gainUsd: p.gainUsd,
    gainPct: p.gainPct,
    money: (v, signed) => (signed ? signedMoney(v) : money(v)),
  });
  // Without a cost basis the honest outcome is the selected window's move.
  const windowMove =
    !ret && p.deltaUsd != null && Math.abs(p.deltaUsd) >= 0.005 ? p.deltaUsd : null;
  // One rule everywhere: up is gain, down is loss, flat is neutral — never a
  // coloured zero.
  const outcomeDir: "up" | "down" | "flat" = ret
    ? ret.direction === "up"
      ? "up"
      : ret.direction === "down"
        ? "down"
        : "flat"
    : windowMove != null
      ? windowMove > 0
        ? "up"
        : "down"
      : "flat";
  const outcomeTone =
    outcomeDir === "up"
      ? "var(--gain)"
      : outcomeDir === "down"
        ? "var(--loss)"
        : "var(--text-muted)";

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
      {/* 1 — What do I believe? pr-9 reserves the corner for the "Stand on it"
        share control layered above the card. */}
      <div className="pr-9 text-[14px] font-semibold leading-snug text-[var(--text)]">
        {p.title}
      </div>

      {/* 2 — One concise sentence explaining what changed. */}
      <div className="mt-1.5 text-[12px] leading-snug text-[var(--text-muted)]">
        {story.headline}
      </div>

      {/* 3 — Side, current value, and the return, each under its own label. */}
      <div className="mt-3 flex items-end gap-6">
        <div>
          <div className="text-[10px] font-semibold tracking-wide" style={{ color: sideColor }}>
            {p.side}
          </div>
          <div className="num mt-0.5 text-[18px] font-semibold leading-none text-[var(--text)]">
            {money(p.value)}
          </div>
          <div className="mt-1 text-[10px] text-[var(--text-muted)]">Current value</div>
        </div>

        {(ret || windowMove != null) && (
          <div className="ml-auto text-right">
            <div
              className="num text-[14px] font-semibold leading-none"
              style={{ color: outcomeTone }}
            >
              {ret ? ret.pnl : signedMoney(windowMove as number)}
              {ret?.pct && <span className="ml-3">{ret.pct}</span>}
            </div>
            <div className="mt-1 text-[10px] text-[var(--text-muted)]">
              Return{ret?.pct && <span className="ml-3">Return %</span>}
            </div>
          </div>
        )}
      </div>

      {/* The only other fact worth a line: you hold the other side of this same
        question, so two cards under one belief read as deliberate. */}
      {p.paired && (
        <div className="mt-2 text-[10px] text-[var(--text-muted)]">
          You also back {p.side === "YES" ? "NO" : "YES"} on this question.
        </div>
      )}
    </div>
  );
}

export function MyConvictions({
  wallet,
  rows,
  window: win = "24h",
  winLabel = "24H",
  ethUsd = 0,
  onSelect,
  onExplore,
  onCount,
  onOpenDashboard,
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
  /** Open the full Conviction Dashboard (complete P&L history). */
  onOpenDashboard?: () => void;
}) {
  const { unit } = useDisplayUnit();
  // Position value and gain are USD-native (POV marks the tokens in dollars); one
  // rate takes them to the viewer's chosen unit so both sides share a rate.
  const money: MoneyFmt = (n) => formatMoney(n, { from: "USD", to: unit, ethUsd });
  const signedMoney: MoneyFmt = (n) =>
    formatMoney(n, { from: "USD", to: unit, ethUsd, signed: true });

  const { data } = useQuery(myConvictionsQO(wallet, win));

  const byId = new Map<number, MarketRow>();
  for (const r of rows) byId.set(Number(r.onchain_id), r);

  // First pass: the honest ownership facts, ONE ENTRY PER HELD SIDE.
  //
  // This used to read the single `stance_side` label and drop anything else, which
  // hid real money two ways: a balanced both-sides holding classifies as MIXED, so
  // the market vanished from the panel entirely; a lopsided one classified as its
  // bigger side, so the smaller holding's value, cost and P&L appeared nowhere —
  // while the dashboard totals counted both. `stance_side` is a stance signal (it
  // belongs in DNA and the House); it is not a holdings filter. Ownership is
  // decided by what you HOLD, exactly as the order dock decides it.
  const facts = ((data?.positions ?? []) as Position[])
    .flatMap((p) => (["YES", "NO"] as Side[]).map((side) => ({ p, side })))
    .map(({ p, side }) => {
      const id = Number(p.onchain_id);
      const m = byId.get(id);
      const st = p.state ?? null;
      const shares = Number((side === "YES" ? p.yes_shares : p.no_shares) ?? 0);
      // Null, not 0. A market the read model has no price for cannot be marked
      // live — and `shares x 0` would call the holding worthless.
      const priceRaw =
        (side === "YES" ? m?.yes_price_usd : m?.no_price_usd) ??
        (side === "YES" ? st?.yes_price_usd : st?.no_price_usd) ??
        null;
      // The ranking that used to live here — fresh mark, else fresh shares×price
      // — now lives in @/domain/position-value, alongside the stale-mark and
      // cost-basis ranks it was missing. One order, tested, shared with cohorts
      // and the dashboard.
      const stale = side === "YES" ? p.yes_value_stale : p.no_value_stale;
      const reported = side === "YES" ? p.yes_value_usd : p.no_value_usd;
      const valuation = positionValueUsd({
        valueUsd: reported,
        // The server already decided staleness against the one canonical rule;
        // re-deriving an age here would be a second answer to that question.
        valueUpdatedAt: stale ? null : Date.now(),
        shares,
        priceUsd: priceRaw,
        // `yes_cost` arrives from getWallet ALREADY IN USD (it runs
        // costBasisUsd server-side), so it is handed in as a rate of 1 rather
        // than converted twice.
        costEth: side === "YES" ? p.yes_cost : p.no_cost,
        ethUsd: 1,
      });
      const value = valuation.usd;
      // OWNERSHIP, NOT PRICEABILITY. This filter used to read `!(value > 0)`,
      // which conflated "you do not hold this side" with "we could not price
      // what you hold" — and silently removed a real holding from the holder's
      // own list whenever the second was true. Holding is the question here.
      if (!(shares > 0)) return null;
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
      // The canonical line for this market, straight off the read model. The
      // card re-tells it from the owner's seat; it never derives its own story.
      const live = st?.live_line_kind
        ? {
            line: st.live_line ?? null,
            kind: st.live_line_kind ?? null,
            window: st.live_line_window ?? null,
            occurredAt: st.live_line_occurred_at ?? null,
            payload: st.live_line_payload ?? null,
          }
        : null;
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
        // A market can appear twice — once per side held — so identity is the
        // market AND the side, never the market alone.
        key: `${id}-${side}`,
        id,
        side,
        value,
        chg,
        invested: pnl.investedUsd,
        gainUsd: pnl.gainUsd,
        gainPct: pnl.gainPct,
        shares,
        entryPrice,
        currentPrice: priceRaw == null || !(Number(priceRaw) > 0) ? null : Number(priceRaw),
        title: marketTitle(p.markets?.title, id),
        believers: believersRaw == null ? null : Number(believersRaw),
        newToday: newTodayRaw == null ? null : Number(newTodayRaw),
        live,
        newInWindow: newWinRaw == null ? null : Number(newWinRaw),
      };
    })
    .filter(Boolean) as {
    key: string;
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
    live: CanonicalLine | null;
  }[];

  // Per-market network signal: pass the wallet so the tape tags Twin/Tribe/Opp
  // and milestones. These lift a card to the top when your people arrive.
  // One tape per MARKET — holding both sides must not fetch it twice.
  const tapeIds = Array.from(new Set(facts.slice(0, 80).map((f) => f.id))).slice(0, 40);
  const { data: tape } = useQuery({
    queryKey: ["positions-tape", wallet ?? null, [...tapeIds].sort((a, b) => a - b)],
    queryFn: () => listLiveEvents({ data: { wallet, marketIds: tapeIds, limit: 120 } }),
    enabled: tapeIds.length > 0,
    // NO INTERVAL — same reason as the pulses. `affectedPositionsTapeKeys` matches
    // this key's id array against the markets that just traded and invalidates it
    // precisely, so the tape is refreshed by the trade rather than by the clock.
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
  const netByMarket = new Map<
    number,
    {
      twin?: "YES" | "NO" | true;
      tribe?: "YES" | "NO" | true;
      opp?: "YES" | "NO" | true;
      milestone?: number | null;
    }
  >();
  for (const r of tape?.rows ?? []) {
    const id = Number(r.marketId);
    const cur = netByMarket.get(id) ?? {};
    const cat = r.story?.category;
    // The side when the row carries one, `true` when it only says they moved.
    // A grouped or non-trade row has no side, and the story still works without.
    const which = r.side ?? true;
    if (cat === "twin") cur.twin = which;
    else if (cat === "tribe") cur.tribe = which;
    else if (cat === "opp") cur.opp = which;
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

  // Markets where BOTH sides survived the ownership test — those cards get a
  // note, so two rows under one question read as deliberate, not as a bug.
  const sidesPerMarket = new Map<number, number>();
  for (const f of facts) sidesPerMarket.set(f.id, (sidesPerMarket.get(f.id) ?? 0) + 1);

  // Second pass: attach the story + pulse, then rank by urgency.
  const built: Built[] = facts.map((f) => {
    const net = netByMarket.get(f.id);
    const signal = positionSignal({
      side: f.side,
      believers: f.believers,
      live: f.live,
      net,
      milestone: net?.milestone ?? null,
    });
    return {
      key: f.key,
      id: f.id,
      side: f.side,
      paired: (sidesPerMarket.get(f.id) ?? 0) > 1,
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
  // Both sides of one market read as one belief with two positions, so the
  // second side follows its partner instead of landing somewhere far down the
  // list under the same question. The market's rank is its strongest side's.
  const grouped: Built[] = [];
  const placed = new Set<string>();
  for (const p of built) {
    if (placed.has(p.key)) continue;
    grouped.push(p);
    placed.add(p.key);
    for (const q of built) {
      if (q.id === p.id && !placed.has(q.key)) {
        grouped.push(q);
        placed.add(q.key);
      }
    }
  }
  const positions = grouped.slice(0, 40);

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
      {/* Summary — one financial story: the value leads, the % is the big right-hand
          figure (same rhythm as the market instrument), the exact move sits beneath. */}
      {(() => {
        const lifetimeMove = trueGain != null && Math.abs(trueGain) >= 0.005;
        const periodMove = !lifetimeMove && Math.abs(periodUsd) >= 0.01;
        const move = lifetimeMove ? (trueGain as number) : periodMove ? periodUsd : 0;
        const basis = total - move;
        const pct =
          move !== 0 && basis > 0 ? formatPct((move / basis) * 100, { precise: true }) : null;
        const tone = move > 0 ? "var(--gain)" : move < 0 ? "var(--loss)" : "var(--text-muted)";
        const arrow = move > 0 ? "▲" : move < 0 ? "▼" : "";
        return (
          <div className="pb-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="num min-w-0 truncate text-[24px] font-semibold leading-none tracking-[-0.02em] text-[var(--text)]">
                {money(total)}
              </span>
              <span
                className="num shrink-0 text-[20px] font-semibold leading-none tabular-nums"
                style={{ color: tone }}
              >
                {pct ?? "—"}
                {arrow && pct ? (
                  <span className="ml-1.5 align-middle text-[0.6em]">{arrow}</span>
                ) : null}
              </span>
            </div>
            <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
              Backing {count} belief{count === 1 ? "" : "s"}
            </div>
            <div className="mt-0.5 flex items-baseline justify-between gap-3">
              <div className="num text-[12px]" style={{ color: tone }}>
                {move === 0 ? (
                  <span className="text-[var(--text-muted)]">—</span>
                ) : (
                  <>
                    {signedMoney(move)}{" "}
                    <span className="font-normal text-[var(--text-muted)]">
                      {lifetimeMove ? "since you started" : winLabel.toLowerCase()}
                    </span>
                  </>
                )}
              </div>

              {onOpenDashboard && (
                <button
                  type="button"
                  onClick={onOpenDashboard}
                  className="shrink-0 text-[11px] font-semibold text-[var(--text-secondary)] underline-offset-2 hover:underline"
                >
                  Full P&amp;L &rarr;
                </button>
              )}
            </div>
          </div>
        );
      })()}

      <div style={{ borderTop: "1px solid var(--hairline)" }} />

      <div className="flex flex-col gap-2.5 pt-4">
        {positions.map((p) => (
          // The share control is a sibling of the card button (never nested — a
          // button inside a button is invalid), pinned to the corner. It stays
          // hidden until the card is hovered or the control itself is focused,
          // so the list reads as beliefs, not toolbars.
          <div key={p.key} className="group relative">
            <ConvictionCard p={p} onSelect={onSelect} money={money} signedMoney={signedMoney} />
            <div className="absolute right-2.5 top-3 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
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
