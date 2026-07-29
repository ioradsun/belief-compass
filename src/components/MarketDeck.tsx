/**
 * CENTER — single-market decision deck.
 *
 * One market at a time: Pulse (why now) → Battlefield (both sides) → the House
 * Read → a persistent dock (shared amount, NO / SKIP / YES). A gesture/button/key
 * only SELECTS a side; buying requires an explicit Confirm after an on-chain
 * quote. Prices/quotes come from the contract (src/lib/chain-trade) — never the
 * client. The House pick unlocks ONLY on a confirmed bet; a skip seals it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getMarketChange } from "@/lib/markets.functions";
import { getMarketEvidence } from "@/lib/evidence.functions";
import { getNetwork } from "@/lib/dna.functions";
import { requestConnect } from "@/lib/connect-bridge";
import { useSwitchChain } from "wagmi";
import type { MarketRow } from "@/components/MarketCard";
import { LiveTape } from "@/components/LiveTape";
import { MarketIntelligence, useHouseFinalize } from "@/components/MarketIntelligence";
import { useEffectiveWallet } from "@/hooks/useEffectiveWallet";
import { expressBelief } from "@/lib/beliefs.functions";
import { convictionSignal, type ConvictionSignal } from "@/domain/conviction";

import { CHAIN_ID } from "@/chain/decoder";
import {
  useBuyQuote,
  useSellQuote,
  useTrade,
  useTradeReady,
  useUserBalance,
} from "@/lib/chain-trade";
import {
  pulseFor,
  usdToWei,
  weiToUsd,
  avgPriceUsd,
  fmtShares,
  fmtUsd,
  selectSide,
  sharesForPct,
  type OrderSide,
} from "@/domain/order";

const PULSE_TONE: Record<string, string> = {
  hot: "#f59e0b",
  warm: "var(--top-voice, #d7ae58)",
  neutral: "var(--text-muted)",
};

/**
 * Momentum tags — the six canonical opportunity classifications from the
 * server-side engine. Color is a second signal only; the word carries meaning.
 */
type WinKey = "1h" | "24h" | "7d" | "30d" | "all";
const WINDOWS: { key: WinKey; label: string }[] = [
  { key: "1h", label: "1H" },
  { key: "24h", label: "1D" },
  { key: "7d", label: "1W" },
  { key: "30d", label: "1M" },
  { key: "all", label: "All" },
];

const MOMENTUM: Record<string, { label: string; hue: string; hint: string }> = {
  hot: { label: "Hot", hue: "#f97316", hint: "Activity is accelerating right now" },
  early: { label: "Early", hue: "#22d3ee", hint: "Real growth, still small and immature" },
  hidden: { label: "Hidden", hue: "#a78bfa", hint: "Heavy turnover for its visible size" },
  contested: { label: "Contested", hue: "#f43f5e", hint: "Both sides balanced and active" },
  conviction: { label: "Conviction", hue: "#34d399", hint: "Holders persisting under challenge" },
  new: { label: "New", hue: "#94a3b8", hint: "Opened in the last 72 hours" },
};

export function MarketDeck({
  row,
  ethUsd,
  onSkip,
  viewerWallet,
}: {
  row: MarketRow;
  ethUsd: number;
  onSkip: () => void;
  viewerWallet?: string;
}) {
  const rr = row as Record<string, unknown>;
  const marketId = Number(row.onchain_id);
  const title = row.markets?.title ?? `Market #${marketId}`;
  const category = row.markets?.category ?? null;
  // POV hosts the same market; the slug comes from their API via the poller.
  const povSlug = row.markets?.pov_slug ?? null;
  const povUrl = povSlug ? `https://pov.co/markets/${povSlug}` : "https://pov.co/";

  const pulse = pulseFor(
    (rr.opportunity_type as string | null) ?? null,
    (rr.opportunity_reason as string | null) ?? null,
  );

  const [amount, setAmount] = useState(1);
  const [side, setSide] = useState<OrderSide | null>(null);
  // Sell is a separate, deliberate mode — a percentage of the held side. Null
  // means "not selling"; the buy dock owns the surface. Buying the opposite side
  // never sells (they're separate token balances), so a flip can't silently exit.
  const [sellPct, setSellPct] = useState<number | null>(null);
  // The viewer walked away here (skip finalizes the round; the pick stays sealed).
  const [skipped, setSkipped] = useState(false);

  const { switchChain } = useSwitchChain();
  const ready = useTradeReady();
  const trade = useTrade();
  const bal = useUserBalance(marketId);
  const house = useHouseFinalize(marketId, viewerWallet);

  // A belief tap records a FREE expressed belief (no money) that feeds DNA /
  // Network / House. Refreshes the viewer's readiness so calibration progresses.
  const qc = useQueryClient();
  const express = useMutation({
    mutationFn: (s: OrderSide) =>
      expressBelief({ data: { wallet: viewerWallet as string, marketId, side: s } }),
    onSuccess: (r) => {
      if (viewerWallet) qc.setQueryData(["readiness", viewerWallet.toLowerCase()], r);
    },
  });

  // Per-share price + % change over a trader-chosen window (1H/1D/1W/1M/All).
  // All windows come in one fetch, so switching is instant; live-refreshed.
  const [win, setWin] = useState<WinKey>("24h");
  const { data: change } = useQuery({
    queryKey: ["market-change", marketId],
    queryFn: () => getMarketChange({ data: { id: marketId } }),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
  const w = change?.windows[win];
  const yesPrice = change?.yesPrice ?? row.yes_price_usd;
  const noPrice = change?.noPrice ?? row.no_price_usd;
  const yesChg = w?.yes ?? (rr.chg_24h_yes as number | null) ?? null;
  const noChg = w?.no ?? (rr.chg_24h_no as number | null) ?? null;

  // Conviction slot — the "diamond hands" read under each side. Reuses the same
  // evidence + network queries the intelligence panel already runs (React Query
  // dedupes by key), so it costs no extra fetch. The pick is a pure ranking:
  // your-network → diamond-hands champion (time × size) → momentum → nothing.
  const connected = useEffectiveWallet();
  const viewer = viewerWallet ?? connected;
  const { data: evidence } = useQuery({
    queryKey: ["evidence", marketId],
    queryFn: () => getMarketEvidence({ data: { marketId } }),
    refetchInterval: 60_000,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  const { data: net } = useQuery({
    queryKey: ["network", viewer ?? null, "all", "relevant", ""],
    queryFn: () => getNetwork({ data: { wallet: viewer, limit: 60 } }),
    enabled: !!viewer,
    staleTime: 60_000,
  });
  const network = new Map(
    (net?.people ?? []).map((p) => [p.wallet.toLowerCase(), p.relationship as string]),
  );
  const holders = evidence?.believers ?? [];
  const yesSignal = convictionSignal(holders, "YES", { network, momentumPct: yesChg });
  const noSignal = convictionSignal(holders, "NO", { network, momentumPct: noChg });

  const ethWei = usdToWei(amount, ethUsd);
  const { quote, isLoading: quoting } = useBuyQuote(marketId, side === "YES", side ? ethWei : 0n);

  // Selecting a side opens the order AND records a free expressed belief (which
  // feeds DNA / Network / calibration). It never reveals the House pick and never
  // buys — only a confirmed on-chain bet unlocks the read.
  const chooseSide = useCallback(
    (s: OrderSide) => {
      if (viewerWallet) express.mutate(s);
      setSide((cur) => selectSide(cur, s));
    },
    // express is stable enough; excluding it avoids re-binding keyboard handlers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [viewerWallet],
  );

  // Skip finalizes the round: the House pick stays sealed (you never paid to see
  // it). This is the FOMO lever, so it's a deliberate, explicit action.
  const chooseSkip = useCallback(() => {
    setSide(null);
    setSkipped(true);
    house.skip();
  }, [house]);

  // Reveal the House pick exactly once, when a bet confirms on-chain.
  const betRevealed = useRef(false);

  // Reset every flow when the market changes.
  useEffect(() => {
    setSide(null);
    setSellPct(null);
    setSkipped(false);
    betRevealed.current = false;
    trade.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketId]);

  // On a confirmed buy, finalize the bet → the House read unlocks above.
  useEffect(() => {
    if (trade.isSuccess && trade.hash && side && !betRevealed.current) {
      betRevealed.current = true;
      house.betReveal(side, trade.hash);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trade.isSuccess, trade.hash, side]);

  // Keyboard: ←/→ select a side, ↑ skip. None of them buy or reveal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && ["INPUT", "TEXTAREA"].includes(el.tagName)) return;
      if (el?.getAttribute("role") === "tab") return;
      if (e.key === "ArrowLeft") chooseSide("NO");
      else if (e.key === "ArrowRight") chooseSide("YES");
      else if (e.key === "ArrowUp") {
        e.preventDefault();
        chooseSkip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chooseSide, chooseSkip]);

  const relationshipBeat = row.story?.beats.find((b) => b.kind === "relationship")?.text ?? null;
  const eventBeat = row.story?.beats.find((b) => b.kind === "event")?.text ?? null;
  const held =
    bal.yes > 0n
      ? { side: "YES" as const, tokens: bal.yes }
      : bal.no > 0n
        ? { side: "NO" as const, tokens: bal.no }
        : null;

  // Sell quote (only while the sell panel is open on a held side).
  const sellShares = held && sellPct != null ? sharesForPct(held.tokens, sellPct) : 0n;
  const { proceeds, isLoading: sellQuoting } = useSellQuote(
    marketId,
    held?.side === "YES",
    sellShares,
  );

  const openSell = () => {
    setSide(null);
    trade.reset();
    setSellPct(100);
  };
  const closeSell = () => {
    setSellPct(null);
    trade.reset();
  };
  const onSellConfirm = async () => {
    if (!ready.connected) return requestConnect();
    if (!ready.onBase) return switchChain({ chainId: CHAIN_ID });
    if (held && proceeds != null && sellShares > 0n && !(trade.isSubmitting || trade.isMining)) {
      try {
        await trade.sell(marketId, held.side === "YES", sellShares, proceeds);
      } catch {
        /* surfaced via trade.error */
      }
    }
  };

  const momentum = MOMENTUM[(rr.opportunity_type as string | null) ?? ""] ?? null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Identity — pinned to the top of the column */}
      <div className="shrink-0">
        <div className="mb-1 flex items-center gap-2">
          {category && (
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
              {category}
            </span>
          )}
          {/* Momentum tag — the market's own classification, stated plainly. */}
          {momentum && (
            <span
              title={momentum.hint}
              className="ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.08em]"
              style={{
                color: momentum.hue,
                background: `color-mix(in oklab, ${momentum.hue} 13%, transparent)`,
                border: `1px solid color-mix(in oklab, ${momentum.hue} 32%, transparent)`,
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ background: momentum.hue }}
                aria-hidden
              />
              {momentum.label}
            </span>
          )}
        </div>

        <h1 className="text-[clamp(20px,2.4vw,30px)] font-semibold leading-tight tracking-tight text-[var(--text)]">
          {title}
        </h1>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-0.5">
        {/* Pulse — why this matters now, plus the day's traded activity */}
        <div className="rounded-[12px] px-3 py-2.5" style={{ border: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: PULSE_TONE[pulse.tone] }}
              aria-hidden
            />
            <span className="text-[13px] font-semibold text-[var(--text)]">
              Pulse: {pulse.label}
            </span>
            <span className="min-w-0 truncate text-[12px] text-[var(--text-secondary)]">
              {pulse.why}
            </span>
          </div>
          {eventBeat && (
            <div className="mt-1 pl-4 text-[12px] text-[var(--text-muted)]">{eventBeat}</div>
          )}
        </div>

        {/* Live tape — this market only, newest first. Titles are redundant here. */}
        <div className="rounded-[12px] px-3 py-2.5" style={{ border: "1px solid var(--border)" }}>
          <div className="mb-1.5 flex items-center gap-2">
            <span
              className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full"
              style={{ background: "var(--yes)" }}
              aria-hidden
            />
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
              Live on this market
            </span>
          </div>
          <div className="max-h-[168px] overflow-y-auto">
            <LiveTape
              marketIds={[marketId]}
              limit={20}
              showTitles={false}
              skeletonRows={3}
              emptyText="No trades on this market yet."
              onSelect={() => {}}
            />
          </div>
        </div>

        {/* Battlefield */}
        <div className="space-y-1.5">
          {/* Says what the numbers ARE, and lets the trader pick the horizon. */}
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-[var(--text-muted)]">
              Price / share · change over
            </span>
            <WindowSelector win={win} onWin={setWin} />
          </div>
          <div className="grid min-h-0 grid-cols-2 gap-2">
            <SideCard
              label="YES"
              price={yesPrice}
              chg={yesChg}
              believers={row.believers_yes}
              capital={row.yes_capital_usd ?? null}
              signal={yesSignal}
              selected={side === "YES"}
              onSelect={() => chooseSide("YES")}
            />
            <SideCard
              label="NO"
              price={noPrice}
              chg={noChg}
              believers={row.believers_no}
              capital={row.no_capital_usd ?? null}
              signal={noSignal}
              selected={side === "NO"}
              onSelect={() => chooseSide("NO")}
            />
          </div>
        </div>

        {/* Compact financial context — never the reason to act */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
          {(rr.volume_24h_usd as number | null) ? (
            <span className="num">{fmtUsd(rr.volume_24h_usd as number)} 24h volume</span>
          ) : null}
          {(rr.trade_count_24h as number | null) ? (
            <span className="num">{rr.trade_count_24h as number} trades today</span>
          ) : null}
        </div>

        {/* DNA / social evidence — only when there's a real signal */}
        {relationshipBeat && (
          <div className="flex items-start gap-2 text-[13px]">
            <span
              className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: "var(--rel,#9b87f5)" }}
              aria-hidden
            />
            <span className="text-[var(--text-secondary)]">{relationshipBeat}</span>
          </div>
        )}

        {/* One intelligence container: House Read · Believers · Defense */}
        <MarketIntelligence marketId={marketId} viewerWallet={viewerWallet} />

        {held && sellPct == null && (
          <div className="flex items-center gap-2 text-[12px] text-[var(--text-muted)]">
            <span>
              You hold <b className="text-[var(--text)]">{held.side}</b> · {fmtShares(held.tokens)}{" "}
              shares
            </span>
            <button
              type="button"
              onClick={openSell}
              className="ml-auto rounded-[10px] px-3 py-1 text-[12px] font-semibold text-[var(--text-secondary)]"
              style={{ border: "1px solid var(--border)" }}
            >
              Sell
            </button>
          </div>
        )}
      </div>

      {/* Decision dock — buy by default; sell takes over when opened on a holding. */}
      <div className="shrink-0">
        {held && sellPct != null ? (
          <SellPanel
            held={held}
            pct={sellPct}
            setPct={setSellPct}
            proceeds={proceeds}
            quoting={sellQuoting}
            ethUsd={ethUsd}
            ready={ready}
            trade={trade}
            onConfirm={onSellConfirm}
            onCancel={closeSell}
            onDone={() => {
              void bal.refetch();
              closeSell();
            }}
          />
        ) : skipped ? (
          /* Walked away: the round is closed and the House pick stays sealed. */
          <div
            className="flex items-center gap-3 rounded-[16px] p-4"
            style={{ border: "1px solid var(--border)" }}
          >
            <div className="min-w-0">
              <div className="text-[14px] font-semibold text-[var(--text)]">You walked away</div>
              <div className="text-[12px] text-[var(--text-muted)]">
                The House kept its read — you never paid to see it.
              </div>
            </div>
            <button
              type="button"
              onClick={onSkip}
              className="ml-auto shrink-0 rounded-[12px] px-4 py-2 text-[13px] font-semibold"
              style={{ background: "var(--text)", color: "var(--bg)" }}
            >
              Next market
            </button>
          </div>
        ) : (
          <Dock
            side={side}
            amount={amount}
            setAmount={setAmount}
            onSelect={(s) => {
              trade.reset();
              chooseSide(s);
            }}
            onCancel={() => setSide(null)}
            onSkip={() => chooseSkip()}
            quote={quote}
            quoting={quoting}
            ethWei={ethWei}
            ethUsd={ethUsd}
            ready={ready}
            trade={trade}
            onConfirm={async () => {
              if (!ready.connected) return requestConnect();
              if (!ready.onBase) return switchChain({ chainId: CHAIN_ID });
              if (side && quote && ethWei > 0n && !(trade.isSubmitting || trade.isMining)) {
                try {
                  await trade.buy(marketId, side === "YES", ethWei, quote.tokens);
                } catch {
                  /* surfaced via trade.error */
                }
              }
            }}
            onDone={() => {
              void bal.refetch();
              onSkip();
            }}
          />
        )}
      </div>
    </div>
  );
}

/** Compact horizon picker: 1H · 1D · 1W · 1M · All. */
function WindowSelector({ win, onWin }: { win: WinKey; onWin: (w: WinKey) => void }) {
  return (
    <div
      className="flex items-center gap-0.5 rounded-full p-0.5"
      style={{ border: "1px solid var(--border)" }}
      role="tablist"
      aria-label="Change window"
    >
      {WINDOWS.map((o) => {
        const on = win === o.key;
        return (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onWin(o.key)}
            className="num rounded-full px-2 py-0.5 text-[10px] font-semibold transition-colors"
            style={
              on
                ? { background: "var(--surface-2,var(--border))", color: "var(--text)" }
                : { color: "var(--text-muted)" }
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function SideCard({
  label,
  price,
  chg,
  believers,
  capital,
  signal,
  selected,
  onSelect,
}: {
  label: OrderSide;
  price: number | null;
  chg: number | null;
  believers: number | null;
  capital: number | null;
  signal: ConvictionSignal | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const yes = label === "YES";
  const col = yes ? "var(--yes)" : "var(--no)";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className="flex flex-col gap-2 rounded-[14px] p-3 text-left transition-colors"
      style={{
        border: `1.5px solid ${selected ? "var(--border-strong,var(--border))" : "var(--border)"}`,
        background: selected ? "var(--surface)" : "transparent",
      }}
    >
      <div className="text-[11px] font-semibold tracking-wide" style={{ color: col }}>
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="num text-[22px] font-semibold leading-none text-[var(--text)]">
          {price == null ? "—" : `$${Number(price).toFixed(2)}`}
        </span>
        {chg != null && Number.isFinite(chg) ? (
          <span
            className="num text-[11px] font-semibold"
            style={{
              color: chg > 0 ? "var(--yes)" : chg < 0 ? "var(--no)" : "var(--text-muted)",
            }}
          >
            {chg > 0 ? "▲" : chg < 0 ? "▼" : "•"} {Math.abs(chg).toFixed(1)}%
          </span>
        ) : (
          <span className="num text-[11px] text-[var(--text-muted)]">—</span>
        )}
      </div>
      <div className="num text-[11px] text-[var(--text-muted)]">
        {believers ?? 0} believers{capital ? ` · ${fmtUsd(capital)}` : ""}
      </div>
      <ConvictionSlot signal={signal} col={col} />
    </button>
  );
}

/**
 * The conviction line: the single truest thing about who is standing on this
 * side. A trusted face gets a colored ring; the diamond-hands champion shows a
 * 💎 and their hold time; a dead side reserves the row height (so the two cards
 * stay aligned) but renders nothing.
 */
function ConvictionSlot({ signal, col }: { signal: ConvictionSignal | null; col: string }) {
  if (!signal) return <div className="h-5" aria-hidden />;
  const emoji = signal.kind === "diamond" ? "💎 " : signal.kind === "whale" ? "🐋 " : "";
  const person = signal.name ?? "";
  return (
    <div
      className="flex h-5 items-center gap-1.5 overflow-hidden"
      title={person ? `${signal.label} · ${person}` : signal.label}
    >
      {signal.avatarUrl ? (
        <img
          src={signal.avatarUrl}
          alt=""
          className="h-4 w-4 shrink-0 rounded-full object-cover"
          style={signal.yours ? { boxShadow: `0 0 0 1.5px ${col}` } : undefined}
        />
      ) : signal.kind !== "momentum" ? (
        <span
          className="h-4 w-4 shrink-0 rounded-full"
          style={{
            background: "var(--surface-2,var(--border))",
            boxShadow: signal.yours ? `0 0 0 1.5px ${col}` : undefined,
          }}
          aria-hidden
        />
      ) : null}
      <span
        className="truncate text-[10px] font-semibold"
        style={{ color: signal.yours ? col : "var(--text-secondary)" }}
      >
        {emoji}
        {signal.label}
      </span>
      {signal.detail && (
        <span className="num shrink-0 text-[10px] text-[var(--text-muted)]">{signal.detail}</span>
      )}
    </div>
  );
}

type TradeApi = ReturnType<typeof useTrade>;

/** Dollar input that accepts decimals (e.g. 0.25, 12.50). */
function AmountField({ amount, setAmount }: { amount: number; setAmount: (n: number) => void }) {
  const [text, setText] = useState(amount ? String(amount) : "");

  // Re-sync when the amount is changed from the outside.
  useEffect(() => {
    const parsed = parseFloat(text);
    if ((Number.isNaN(parsed) ? 0 : parsed) !== amount) {
      setText(amount ? String(amount) : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount]);

  return (
    <span
      className="flex h-[52px] items-center gap-1 rounded-[12px] px-3"
      style={{ border: "1px solid var(--border)" }}
    >
      <span className="num text-[15px] text-[var(--text-muted)]">$</span>
      <input
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          // Keep digits and a single decimal point, max 2 decimals.
          let raw = e.target.value.replace(/[^0-9.]/g, "");
          const first = raw.indexOf(".");
          if (first !== -1) {
            raw = raw.slice(0, first + 1) + raw.slice(first + 1).replace(/\./g, "");
            const [int, dec] = raw.split(".");
            raw = `${int}.${(dec ?? "").slice(0, 2)}`;
          }
          const n = parseFloat(raw);
          if (!Number.isNaN(n) && n > 1_000_000) {
            setText("1000000");
            setAmount(1_000_000);
            return;
          }
          setText(raw);
          setAmount(Number.isNaN(n) ? 0 : n);
        }}
        onBlur={() => setText(amount ? String(amount) : "")}
        aria-label="Amount in dollars"
        className="num w-[86px] bg-transparent text-[18px] font-semibold text-[var(--text)] outline-none"
        placeholder="0"
      />
    </span>
  );
}

function Dock({
  side,
  amount,
  setAmount,
  onSelect,
  onCancel,
  onSkip,
  quote,
  quoting,
  ethWei,
  ethUsd,
  ready,
  trade,
  onConfirm,
  onDone,
}: {
  side: OrderSide | null;
  amount: number;
  setAmount: (n: number) => void;
  onSelect: (s: OrderSide) => void;
  onCancel: () => void;
  onSkip: () => void;
  quote: { tokens: bigint; fee: bigint; refund: bigint } | null;
  quoting: boolean;
  ethWei: bigint;
  ethUsd: number;
  ready: { connected: boolean; onBase: boolean };
  trade: TradeApi;
  onConfirm: () => void;
  onDone: () => void;
}) {
  // Receipt.
  if (trade.isSuccess && side) {
    return (
      <div
        className="rounded-[16px] p-4"
        style={{ border: "1px solid var(--border-strong,var(--border))" }}
      >
        <div className="flex items-center gap-3">
          <span
            className="grid h-7 w-7 place-items-center rounded-full"
            style={{
              background: "var(--surface)",
            }}
          >
            <span style={{ color: side === "YES" ? "var(--yes)" : "var(--no)" }}>✓</span>
          </span>
          <div>
            <div className="text-[15px] font-semibold text-[var(--text)]">
              Joined {side} · House read revealed ↑
            </div>
            {quote && (
              <div className="num text-[11px] text-[var(--text-muted)]">
                {fmtShares(quote.tokens)} shares at $
                {avgPriceUsd(ethWei, quote.tokens, ethUsd).toFixed(2)} avg
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onDone}
            className="ml-auto rounded-[12px] px-4 py-2 text-[13px] font-semibold text-[var(--bg)]"
            style={{ background: "var(--text)" }}
          >
            Next market
          </button>
        </div>
      </div>
    );
  }

  const busy = trade.isSubmitting || trade.isMining;
  const amtField = <AmountField amount={amount} setAmount={setAmount} />;

  // Neutral: NO · SKIP · YES.
  if (!side) {
    return (
      <div
        className="flex items-center gap-2 rounded-[16px] p-3"
        style={{ border: "1px solid var(--border)" }}
      >
        {amtField}
        <div className="flex flex-1 gap-2">
          <DockBtn label="← NO" tone="no" onClick={() => onSelect("NO")} />
          <DockBtn label="↑ SKIP" tone="skip" onClick={onSkip} />
          <DockBtn label="YES →" tone="yes" onClick={() => onSelect("YES")} />
        </div>
      </div>
    );
  }

  // Belief expressed → optional financial backing. Nothing is preselected and
  // no transaction happens without this explicit confirmation.
  const confirmLabel = !ready.connected
    ? "Connect wallet"
    : !ready.onBase
      ? "Switch to Base"
      : `Back ${side} · ${fmtUsd(amount)}`;
  // Disabled only once connected + on Base but the quote isn't ready.
  const disabled = ready.connected && ready.onBase && (busy || !quote || ethWei <= 0n);

  return (
    <div className="rounded-[16px] p-3" style={{ border: "1px solid var(--border)" }}>
      {/* Quote review */}
      <div className="mb-2 space-y-1 px-1">
        <div className="pb-1 text-[11px] font-semibold text-[var(--text)]">
          Back {side} to reveal the House’s pick.
        </div>
        <QuoteRow
          k="You pay"
          v={`${fmtUsd(amount)}  ·  ${(Number(ethWei) / 1e18).toFixed(4)} ETH`}
        />
        <QuoteRow k="Shares" v={quoting ? "…" : quote ? fmtShares(quote.tokens) : "—"} />
        <QuoteRow
          k="Avg price"
          v={quote ? `$${avgPriceUsd(ethWei, quote.tokens, ethUsd).toFixed(2)}` : "—"}
        />
        {trade.isError && (
          <div className="text-[11px] text-[var(--no)]">
            {trade.error?.message?.slice(0, 90) ?? "Transaction failed."}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        {amtField}
        <div className="flex flex-1 gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="h-[52px] flex-1 rounded-[12px] text-[14px] font-medium text-[var(--text-secondary)]"
            style={{ border: "1px solid var(--border)" }}
          >
            Not now
          </button>

          <button
            type="button"
            disabled={disabled}
            onClick={onConfirm}
            className="h-[52px] flex-[2] rounded-[12px] text-[15px] font-semibold disabled:opacity-40"
            style={{
              background: "var(--text)",
              color: "var(--bg)",
            }}
          >
            {busy ? "Confirming…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function SellPanel({
  held,
  pct,
  setPct,
  proceeds,
  quoting,
  ethUsd,
  ready,
  trade,
  onConfirm,
  onCancel,
  onDone,
}: {
  held: { side: OrderSide; tokens: bigint };
  pct: number;
  setPct: (n: number) => void;
  proceeds: bigint | null;
  quoting: boolean;
  ethUsd: number;
  ready: { connected: boolean; onBase: boolean };
  trade: TradeApi;
  onConfirm: () => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  // Receipt.
  if (trade.isSuccess) {
    return (
      <div
        className="rounded-[16px] p-4"
        style={{ border: "1px solid var(--border-strong,var(--border))" }}
      >
        <div className="flex items-center gap-3">
          <span
            className="grid h-7 w-7 place-items-center rounded-full"
            style={{ background: "color-mix(in oklab,var(--text-muted) 18%,transparent)" }}
          >
            <span className="text-[var(--text-secondary)]">✓</span>
          </span>
          <div>
            <div className="text-[15px] font-semibold text-[var(--text)]">Left {held.side}</div>
            {proceeds != null && (
              <div className="num text-[11px] text-[var(--text-muted)]">
                Sold {pct}% · +{fmtUsd(weiToUsd(proceeds, ethUsd))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onDone}
            className="ml-auto rounded-[12px] px-4 py-2 text-[13px] font-semibold text-[var(--bg)]"
            style={{ background: "var(--text)" }}
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  const busy = trade.isSubmitting || trade.isMining;
  const shares = sharesForPct(held.tokens, pct);
  const confirmLabel = !ready.connected
    ? "Connect wallet"
    : !ready.onBase
      ? "Switch to Base"
      : `Sell ${pct}% of ${held.side}`;
  const disabled = ready.connected && ready.onBase && (busy || proceeds == null || shares <= 0n);

  return (
    <div
      className="rounded-[16px] p-3"
      style={{ border: "1px solid var(--border-strong,var(--border))" }}
    >
      <div className="mb-2 flex items-center gap-2 px-1">
        <span className="text-[12px] font-semibold text-[var(--text)]">
          Sell{" "}
          <span style={{ color: held.side === "YES" ? "var(--yes)" : "var(--no)" }}>
            {held.side}
          </span>
        </span>
        <span className="ml-auto flex gap-1">
          {[25, 50, 100].map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPct(p)}
              className="rounded-[8px] px-2 py-1 text-[11px] font-semibold"
              style={
                pct === p
                  ? { background: "var(--text)", color: "var(--bg)" }
                  : { border: "1px solid var(--border)", color: "var(--text-secondary)" }
              }
            >
              {p === 100 ? "All" : `${p}%`}
            </button>
          ))}
        </span>
      </div>
      <div className="mb-2 space-y-1 px-1">
        <QuoteRow k="Selling" v={`${fmtShares(shares)} shares`} />
        <QuoteRow
          k="You receive"
          v={quoting ? "…" : proceeds != null ? `≈ ${fmtUsd(weiToUsd(proceeds, ethUsd))}` : "—"}
        />
        {trade.isError && (
          <div className="text-[11px] text-[var(--no)]">
            {trade.error?.message?.slice(0, 90) ?? "Transaction failed."}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-[52px] flex-1 rounded-[12px] text-[14px] font-medium text-[var(--text-secondary)]"
          style={{ border: "1px solid var(--border)" }}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={onConfirm}
          className="h-[52px] flex-[2] rounded-[12px] text-[15px] font-semibold disabled:opacity-40"
          style={{ background: "var(--text)", color: "var(--bg)" }}
        >
          {busy ? "Selling…" : confirmLabel}
        </button>
      </div>
    </div>
  );
}

function DockBtn({
  label,
  tone,
  onClick,
}: {
  label: string;
  tone: "yes" | "no" | "skip";
  onClick: () => void;
}) {
  const style =
    tone === "yes"
      ? {
          border: "1px solid var(--border-strong,var(--border))",
          background: "var(--surface)",
          color: "var(--yes)",
        }
      : tone === "no"
        ? {
            border: "1px solid var(--border-strong,var(--border))",
            background: "var(--surface)",
            color: "var(--no)",
          }
        : { border: "1px solid var(--border)", color: "var(--text-secondary)" };
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-[52px] flex-1 rounded-[12px] text-[14px] font-semibold transition-colors"
      style={style}
    >
      {label}
    </button>
  );
}

function QuoteRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[11px] text-[var(--text-muted)]">{k}</span>
      <span className="num text-[12px] font-semibold text-[var(--text-secondary)]">{v}</span>
    </div>
  );
}
