/**
 * LEFT PANEL — "Your Convictions". A PORTFOLIO VIEW, not a second newsroom.
 *
 * Each card answers, in order: what am I backing (the question), which side am I
 * on, what is it worth now, how is it doing (return %) — and, only when the
 * platform's own persisted market fact is material, one quiet line of context.
 *
 * Positions computes no intelligence. It reads the shared financial functions
 * (@/domain/position-value, @/domain/position, @/domain/metric-display) and the
 * canonical `market_state.live_line`, re-told from the owner's seat by the pure
 * @/domain/position-story. It does NOT scan the tape, score attention, rank by
 * newsworthiness, or ask questions — that is Insider's job, and duplicating it
 * here produced a second, weaker answer to the same question.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { type VolumeWindow } from "@/lib/markets.functions";
import { positionValueUsd, isMeasured } from "@/domain/position-value";
import { useViewerPositions } from "@/lib/positions-query";
import { type MarketRow } from "@/components/MarketCard";
import { positionPnl } from "@/domain/position";
import { positionReturn, formatPct } from "@/domain/metric-display";
import { formatMoney } from "@/domain/money";
import { formatCC } from "@/domain/simulation";
import { StandOnIt } from "@/components/StandOnIt";
import { Signed } from "@/components/Signed";
import { useMarkets } from "@/components/MarketsPanel";


import { useDisplayUnit } from "@/lib/display-unit";
import {
  positionStory,
  type CanonicalLine,
  type PositionStory,
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
  believer_delta_yes_win?: number | null;
  believer_delta_no_win?: number | null;
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
  /** You WROTE this question. A permanent fact about the market, not the holding. */
  maker: boolean;

  value: number;
  /** The value is a real mark, not a cost-basis stand-in. False → no return yet. */
  priced: boolean;
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
  /** The persisted canonical fact, in the owner's voice — or null: stay quiet. */
  story: PositionStory | null;
};

/**
 * ONE CONVICTION, FOUR ANSWERS.
 *
 * What am I backing → which side → what is it worth → how is it doing. A fifth
 * line appears only when the platform already knows something material about the
 * market. Nothing else earns space:
 *
 *  • Absolute P&L — removed from the scan surface. Value and return % answer
 *    "how is it doing" in one read; the dollar gain is one tap away on Full P&L.
 *    The number is still computed, still exact, just not printed twice here.
 *  • Pulse label, believers row, shares/entry, dividers — removed earlier, for
 *    the same reason: they do not change a decision at a glance.
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
  const story = p.story;
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
  // Colour lives on the sign only (see @/components/Signed) — the figure itself
  // stays neutral, and a flat outcome is never coloured at all.


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
        share control layered above the card.

        THE QUESTION IS THE ONLY BRIGHT THING HERE. Everything under it — the
        story, the side, the figures — is supporting evidence, so it borrows the
        Insider tape's scale (13/11px, secondary and muted) rather than
        competing at full strength. A card that shouts four times says nothing. */}
      <div className="pr-9 text-[13px] font-semibold leading-snug text-[var(--text)]">
        {p.title}
      </div>

      {/* 2 — The platform's own material fact about this market, in the owner's
        voice. Absent when nothing material is on file: a position card does not
        require commentary. */}
      {story && (
        <div className="mt-1.5 text-[11px] leading-snug text-[var(--text-muted)]">
          {story.headline}
        </div>
      )}

      {/* 3 — Side, current value, and the return. One quiet row: the side is a
        label, not a banner, so its colour is mixed back toward the muted text
        it sits beside; the figures step down to 15px so the question above
        stays the first read. */}
      <div className="mt-2.5 flex items-end gap-6">
        <div>
          <div
            className="text-[10px] font-semibold uppercase tracking-[0.08em]"
            style={{ color: `color-mix(in oklab, ${sideColor} 70%, var(--text-muted))` }}
          >
            {p.side}
          </div>
          <div className="num mt-1 text-[15px] leading-none text-[var(--text)]">
            {money(p.value)}
          </div>
          <div className="mt-1 text-[10px] text-[var(--text-muted)]">Value</div>
        </div>

        {ret?.pct || windowMove != null ? (
          <div className="ml-auto text-right">
            {/* The return %, whenever a cost basis exists. Without one there is
              no percentage to state, so the window's dollar move stands in —
              the only honest measure left. Colour follows @/components/Signed. */}
            <Signed
              value={ret?.pct ?? signedMoney(windowMove as number)}
              className="num block text-[15px] leading-none"
            />

            <div className="mt-1 text-[10px] text-[var(--text-muted)]">Return</div>
          </div>
        ) : (
          // NOT PRICED IS NOT FLAT. Saying so plainly beats a dash the holder
          // reads as "nothing happened".
          !p.priced && (
            <div className="ml-auto text-right text-[10px] text-[var(--text-muted)]">
              Not priced yet
            </div>
          )
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
  /**
   * WHICH LEDGER, AND THEREFORE WHICH FORMATTER.
   *
   * The arithmetic below is identical in both modes — value, cost, return, the
   * story — because a simulated position is a real position with a fake balance
   * behind it. The ONE thing that must not be shared is the unit: a CC figure
   * rendered through `formatMoney` would print a dollar sign on something that
   * has no monetary value, which is the single sentence this whole mode exists
   * not to say.
   */
  const { positions: rawPositions, simulated } = useViewerPositions(wallet, win);

  /**
   * AUTHORSHIP IS A PROPERTY OF THE CARD, NOT A SECOND LIST.
   *
   * MARKETS used to open with a Market Maker section and a Believer section, and
   * then show the same questions again as position cards underneath — one market
   * rendered twice, in two vocabularies, with two different figures. The role is
   * a single fact about a market, so it belongs ON the market's one card.
   *
   * The read is the same query the sections used, so nothing new is fetched.
   */
  const { data: marketEntries } = useMarkets(wallet);
  const makerIds = new Set(
    (marketEntries ?? []).filter((e) => e.ownership === "market_maker").map((e) => e.marketId),
  );

  // Position value and gain are USD-native (POV marks the tokens in dollars); one
  // rate takes them to the viewer's chosen unit so both sides share a rate.
  const money: MoneyFmt = simulated
    ? (n) => formatCC(n)
    : (n) => formatMoney(n, { from: "USD", to: unit, ethUsd });
  const signedMoney: MoneyFmt = simulated
    ? (n) => formatCC(n, true)
    : (n) => formatMoney(n, { from: "USD", to: unit, ethUsd, signed: true });

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
  const facts = (rawPositions as unknown as Position[])
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
      // A COST FALLBACK IS NOT A VALUATION. When nothing could price the holding,
      // `value` IS the cost basis — subtracting one from the other yields exactly
      // zero, which the card printed as "no movement". That is a claim we have not
      // earned, so gain stays unknown until the position is genuinely marked.
      const measured = isMeasured(valuation);
      const pnl = positionPnl({ invested, worth: measured ? value : null });
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
        priced: measured,
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
        believerDelta:
          (side === "YES" ? p.believer_delta_yes_win : p.believer_delta_no_win) ?? null,
        newInWindow: newWinRaw == null ? null : Number(newWinRaw),
      };
    })
    .filter(Boolean) as {
    key: string;
    id: number;
    side: Side;
    value: number;
    priced: boolean;
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
    believerDelta: number | null;
  }[];

  // THE TAPE SCAN IS GONE. This used to fetch `listLiveEvents` for up to 40 held
  // markets and reconstruct Twin / Tribe / Opp / milestone signals from raw rows —
  // Positions reading the feed to decide what a market meant, in parallel with
  // (and weaker than) the Insider pipeline that owns that judgement. Network
  // intelligence belongs to Insider; a portfolio does not re-derive it.


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

  // Second pass: attach the optional canonical line. No scoring happens here.
  const built: Built[] = facts.map((f) => {
    const story = positionStory({
      side: f.side,
      believers: f.believers,
      live: f.live,
      believerDelta: f.believerDelta,
    });
    return {
      key: f.key,
      id: f.id,
      side: f.side,
      paired: (sidesPerMarket.get(f.id) ?? 0) > 1,
      value: f.value,
      priced: f.priced,
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
      story,
    };
  });

  // WHERE IS MY MONEY — the only question a portfolio order can answer honestly.
  // The old sort led with STORY_RANK, an editorial urgency scale: a card rose
  // because its sentence was interesting, not because the holding was large. That
  // is a second newsroom, and it buried the biggest position under the loudest
  // one. Value descending, with the position key as the deterministic tie-break
  // so equal values never shuffle between renders.
  built.sort((a, b) => b.value - a.value || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

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

  /**
   * ONE SOURCE OF TRUTH FOR THE HEADLINE.
   *
   * The summary used to be computed from a different input than the cards it sits
   * above: the cards read cost-basis P&L (`gainUsd`/`gainPct`), while the summary
   * read the MARKET's window price change (`windowDelta`) and only fell back to
   * P&L on the "All" window — and then only when EVERY position had a basis. One
   * unpriced holding, or a market with no window change on file, and the reader
   * saw a blank "—" above a column of real returns.
   *
   * The headline is now the same arithmetic the cards perform, summed:
   *   gain  = Σ gainUsd over positions we can actually mark
   *   basis = Σ (value − gainUsd) over those same positions   [= Σ invested]
   *   pct   = gain / basis
   * Positions with no trusted basis contribute to the total VALUE and to nothing
   * else, which is exactly how their own card behaves.
   */
  const marked = built.filter((p) => p.gainUsd != null);
  const markedGain = marked.reduce((s, p) => s + (p.gainUsd ?? 0), 0);
  const markedBasis = marked.reduce((s, p) => s + (p.value - (p.gainUsd ?? 0)), 0);
  const hasBasis = marked.length > 0 && markedBasis > 0;
  // Only when nothing at all can be marked does the window move stand in.
  const periodUsd = built.reduce((s, p) => s + (windowDelta(p.value, p.chg) ?? 0), 0);
  

  // ONE COUNT, ONE MEANING. The tab strip used to receive `built.length` — a
  // count of POSITIONS — while the rail printed "Backing N beliefs" from the same
  // number, so a market held on both sides silently counted as two beliefs. The
  // tab now receives the number of distinct markets, which is what "Positions N"
  // reads as, and the rail no longer prints a second count beside it.
  const marketCount = sidesPerMarket.size;
  useEffect(() => {
    onCount?.(marketCount);
  }, [marketCount, onCount]);


  if (!wallet || built.length === 0) {
    return <EmptyState onExplore={onExplore} />;
  }

  return (
    <div>
      {/* Summary — the portfolio outcome in two figures of equal weight: what it
          is worth, and what it has returned. The unrealized dollar line and the
          "Backing N beliefs" count are gone: the first repeated the percentage in
          another unit, the second repeated the tab's count with subtly different
          semantics. Both totals are still exact on Full P&L. */}
      {(() => {
        // The cards' own arithmetic, summed. A percentage exists whenever a cost
        // basis does — a sub-cent dollar move must never blank the return, which
        // is exactly the "—" the reader was seeing above priced positions.
        const move = hasBasis ? markedGain : periodUsd;
        const basis = hasBasis ? markedBasis : total - move;
        const pct = basis > 0 && (hasBasis || move !== 0)
          ? formatPct((move / basis) * 100, { precise: true })
          : null;
        return (
          <div className="pb-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="num min-w-0 truncate text-[24px] font-semibold leading-none tracking-[-0.02em] text-[var(--text)]">
                {money(total)}
              </span>
              {/* Signed owns the arrow and the colour — see @/components/Signed. */}
              <Signed
                value={pct ?? "—"}
                className="num shrink-0 text-[24px] font-semibold leading-none tabular-nums"
              />

            </div>
            <div className="mt-1.5 flex items-baseline justify-between gap-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                Portfolio value
              </span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
                Return
              </span>
            </div>

            {/* NO REAL-MONEY DASHBOARD FROM A SIMULATED PANEL. Full P&L is the
                complete history of actual trades; opening it from a CC portfolio
                would put two ledgers one tap apart with nothing saying which is
                which. The banner's Exit is the route back to it. */}
            {onOpenDashboard && !simulated && (
              <div className="mt-2.5">
                <button
                  type="button"
                  onClick={onOpenDashboard}
                  className="text-[11px] font-semibold text-[var(--text-secondary)] underline-offset-2 hover:underline"
                >
                  Full P&amp;L &rarr;
                </button>
              </div>
            )}
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
