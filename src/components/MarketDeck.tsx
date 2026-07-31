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
import { getMarketChange, getPositionSummary } from "@/lib/markets.functions";
import { setDeckWindow } from "@/lib/deck-window";
import { positionPnl, type PositionPnl } from "@/domain/position";
import { getMarketEvidence } from "@/lib/evidence.functions";
import { requestConnect } from "@/lib/connect-bridge";
import { useSwitchChain, useAccount, useBalance } from "wagmi";
import type { MarketRow } from "@/components/MarketCard";
import { MarketIntelligence, useHouseFinalize } from "@/components/MarketIntelligence";
import { CaseStory } from "@/components/CaseStory";
import { useEffectiveWallet } from "@/hooks/useEffectiveWallet";
import { expressBelief } from "@/lib/beliefs.functions";
import { useWalletSession } from "@/hooks/useWalletSession";
import { MarketVitalityPanel } from "@/components/MarketVitality";
import { marketVitality, vitalityPulse } from "@/domain/market-vitality";
import type { TapeTrade } from "@/domain/conviction-series";
import { type FlowWindow } from "@/domain/market-flow";

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

import { LensPicker, type Lens, type LensOption } from "@/components/OmniHeader";
import { ReportMarket } from "@/components/ReportMarket";
import { PostPurchase } from "@/components/PostPurchase";
import { getConvictionMarket } from "@/lib/market-create.functions";

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

/** Signed dollar/percent for personal gain (loss uses a true minus glyph). */
const signedUsd = (n: number) => `${n < 0 ? "−" : "+"}${fmtUsd(Math.abs(n))}`;
const signedPct = (n: number | null) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : `${n < 0 ? "−" : "+"}${Math.abs(n).toFixed(Math.abs(n) > 0 && Math.abs(n) < 10 ? 1 : 0)}%`;

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
  lens,
  lenses,
  onLens,
  caseOpen = false,
  onToggleCase,
  storySide = null,
  onCloseStory,
}: {
  row: MarketRow;
  ethUsd: number;
  onSkip: () => void;
  viewerWallet?: string;
  /** When provided, the momentum chip doubles as the deck's lens filter. */
  lens?: Lens;
  lenses?: LensOption[];
  onLens?: (l: Lens) => void;
  /** Case File mode: the YES/NO evidence moves to the side columns. */
  caseOpen?: boolean;
  onToggleCase?: () => void;
  /** Investigation mode: one side's story takes the center. */
  storySide?: OrderSide | null;
  onCloseStory?: () => void;
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
  const { ensureSession } = useWalletSession();
  const express = useMutation({
    mutationFn: async (s: OrderSide) =>
      expressBelief({
        data: {
          wallet: viewerWallet as string,
          marketId,
          side: s,
          session: await ensureSession(),
        },
      }),
    onSuccess: (r) => {
      if (viewerWallet) qc.setQueryData(["readiness", viewerWallet.toLowerCase()], r);
    },
  });

  // The trader-chosen horizon. It no longer drives anything in the neutral
  // center — it is the Case File's range control, published so both evidence
  // columns read the same period.
  const [win, setWinLocal] = useState<WinKey>("24h");
  const setWin = (next: WinKey) => {
    setWinLocal(next);
    setDeckWindow(next as FlowWindow);
  };
  const { data: change } = useQuery({
    queryKey: ["market-change", marketId],
    queryFn: () => getMarketChange({ data: { id: marketId } }),
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const connected = useEffectiveWallet();
  const viewer = viewerWallet ?? connected;
  const { data: evidence } = useQuery({
    queryKey: ["evidence", marketId],
    queryFn: () => getMarketEvidence({ data: { marketId } }),
    refetchInterval: 60_000,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });
  const holders = evidence?.believers ?? [];

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

  // The viewer's honest ownership numbers on THIS market (cost basis + worth).
  // Off the reducer/POV read model — never inferred from a price percentage.
  const { data: posSummary } = useQuery({
    queryKey: ["position-summary", viewerWallet ?? null, marketId],
    queryFn: () => getPositionSummary({ data: { wallet: viewerWallet as string, marketId } }),
    enabled: !!viewerWallet,
    staleTime: 15_000,
    refetchInterval: 20_000,
    placeholderData: (prev) => prev,
  });
  const heldSideData = held ? posSummary?.[held.side === "YES" ? "yes" : "no"] : null;
  const heldPnl = positionPnl({
    invested: heldSideData?.invested,
    worth: heldSideData?.worth,
  });

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

  // A completed BUY takes over the whole center: the purchase becomes belonging,
  // not a receipt. (A sell keeps its own compact receipt in the dock below.)
  if (trade.isSuccess && side != null && sellPct == null) {
    const shareUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}${window.location.pathname}?m=${marketId}`
        : `?m=${marketId}`;
    return (
      <PostPurchase
        side={side}
        title={title}
        believers={side === "YES" ? row.believers_yes : row.believers_no}
        faces={holders.filter((b) => b.side === side)}
        shareUrl={shareUrl}
        investedUsd={amount}
        onNext={() => {
          void bal.refetch();
          onSkip();
        }}
      />
    );
  }

  const momentum = MOMENTUM[(rr.opportunity_type as string | null) ?? ""] ?? null;
  // One chip: the market's momentum tag when no lens is applied, the active lens
  // once you pick one. Same vocabulary, same place — no duplicated row above.
  const lensMomentum = lens && lens !== "all" ? MOMENTUM[lens] : null;
  const chipTone = lensMomentum?.hue ?? momentum?.hue;
  const chipLabel = lensMomentum?.label ?? momentum?.label;
  const chipHint = lensMomentum?.hint ?? momentum?.hint;

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
          {lens && lenses && onLens ? (
            <span className="ml-auto">
              <LensPicker
                lens={lens}
                lenses={lenses}
                onLens={onLens}
                tone={chipTone}
                label={chipLabel}
                title={chipHint}
                align="right"
              />
            </span>
          ) : (
            momentum && (
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
            )
          )}
        </div>

        <h1 className="text-[clamp(20px,2.4vw,30px)] font-semibold leading-tight tracking-tight text-[var(--text)]">
          {title}
        </h1>
        <MarketByline onchainId={Number(row.onchain_id)} />
      </div>

      {/* Investigation Mode: one side's story replaces the comparison, while the
        side columns stay put as anchors and the decision dock stays reachable. */}
      {storySide ? (
        <CaseStory
          side={storySide}
          marketId={marketId}
          ethUsd={ethUsd}
          backed={side === storySide}
          onBack={() => chooseSide(storySide)}
          onClose={() => onCloseStory?.()}
        />
      ) : (
        <div className="flex min-h-0 flex-1 touch-pan-y flex-col gap-4 overflow-y-scroll overscroll-contain pr-0.5 [-webkit-overflow-scrolling:touch]">
          {/* Range control belongs to the evidence, so it only appears with it. */}
          {caseOpen && (
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-[var(--text-muted)]">Evidence over</span>
              <WindowSelector win={win} onWin={setWin} />
            </div>
          )}

          <ConvictionMedia
            onchainId={Number(row.onchain_id)}
            title={String((rr.title as string | null) ?? "Market media")}
          />

          {/* Neutral market vitality — people and money for the WHOLE market. The
          split between YES and NO is evidence, and lives in the Case File. */}
          <MarketVitalityPanel tape={change?.tape} ethUsd={ethUsd} />

          {/* One intelligence container. In the neutral center it is House Read
          only — the per-side lenses are Case File material. */}
          <MarketIntelligence
            marketId={marketId}
            viewerWallet={viewerWallet}
            caseOpen
            neutral={!caseOpen}
          />

          {/* Pulse — recent whole-market activity, never which side it happened on. */}
          <NeutralPulse tape={change?.tape} ethUsd={ethUsd} fallback={pulse.why} />

          {/* Compact context — never the reason to act */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--text-muted)]">
            {(rr.volume_24h_usd as number | null) ? (
              <span className="num">{fmtUsd(rr.volume_24h_usd as number)} 24h volume</span>
            ) : null}
            {(rr.trade_count_24h as number | null) ? (
              <span className="num">{rr.trade_count_24h as number} trades today</span>
            ) : null}
            <span className="ml-auto">
              <ReportMarket onchainId={Number(row.onchain_id)} wallet={viewerWallet} />
            </span>
          </div>

          {held && sellPct == null && (
            <PositionSummary
              side={held.side}
              pnl={heldPnl}
              tokens={held.tokens}
              onSell={openSell}
            />
          )}
        </div>
      )}

      {/* Decision dock — buy by default; sell takes over when opened on a holding. */}
      <div className="shrink-0 space-y-2">
        {onToggleCase && !storySide && <ExamineCta open={caseOpen} onToggle={onToggleCase} />}

        {held && sellPct != null ? (
          <SellPanel
            held={held}
            pct={sellPct}
            setPct={setSellPct}
            proceeds={proceeds}
            quoting={sellQuoting}
            ethUsd={ethUsd}
            worthUsd={heldSideData?.worth ?? null}
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

/** Who opened the question, and when. Secondary to the question itself. */
function MarketByline({ onchainId }: { onchainId: number }) {
  const { data } = useQuery({
    queryKey: ["conviction-market", onchainId],
    queryFn: () => getConvictionMarket({ data: { onchainId } }),
    staleTime: 5 * 60_000,
  });
  const m = data?.market as { creator_wallet?: string | null; created_at?: string | null } | null;
  if (!m?.creator_wallet && !m?.created_at) return null;
  const who = m.creator_wallet
    ? `${m.creator_wallet.slice(0, 6)}…${m.creator_wallet.slice(-4)}`
    : null;
  const when = m.created_at ? ageWords(Date.now() - new Date(m.created_at).getTime()) : null;
  return (
    <p className="mt-1.5 text-[11px] text-[var(--text-muted)]">
      {who ? `Created by ${who}` : "Created"}
      {when ? ` · ${when}` : ""}
    </p>
  );
}

function ageWords(ms: number): string {
  const h = Math.max(0, ms) / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`;
  if (h < 48) return `${Math.round(h)}h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

/**
 * Pulse — two separate answers, never merged: what the market looks like NOW
 * (state) and what changed in the selected window (activity). It never names a
 * side; that belongs to the evidence columns.
 */
function NeutralPulse({
  tape,
  ethUsd,
  win,
  priceChange,
  fallback,
}: {
  tape: TapeTrade[] | undefined;
  ethUsd: number;
  win: FlowWindow;
  priceChange: { yes: number | null; no: number | null } | undefined;
  fallback: string;
}) {
  if (!tape?.length) {
    return (
      <PulseShell periodShort={FLOW_WINDOW_SHORT[win]} label="No conviction yet">
        <p className="text-[13px] leading-snug text-[var(--text-secondary)]">{fallback}</p>
      </PulseShell>
    );
  }

  const input = pulseInputFromTape(tape, win, Date.now(), ethUsd);
  // Price is supporting context only: read the majority side's move, unnamed.
  const majorityMove =
    input.yesBelievers >= input.noBelievers ? priceChange?.yes : priceChange?.no;
  const p = composePulse({ ...input, periodPriceChange: majorityMove ?? null });

  return (
    <PulseShell periodShort={p.periodShort} label={p.stateLabel}>
      <p className="text-[13px] leading-snug text-[var(--text-secondary)]">{p.stateExplanation}</p>
      <div className="mt-3 border-t pt-2" style={{ borderColor: "var(--border)" }}>
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
          {p.activityLabel}
        </div>
        <p className="mt-0.5 text-[12px] leading-snug text-[var(--text-muted)]">
          {p.activityExplanation}
        </p>
        {p.activityMetrics && (
          <p className="num mt-1 text-[12px] text-[var(--text-secondary)]">{p.activityMetrics}</p>
        )}
      </div>
    </PulseShell>
  );
}

function PulseShell({
  periodShort,
  label,
  children,
}: {
  periodShort: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[12px] px-3 py-2.5" style={{ border: "1px solid var(--border)" }}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
        Pulse · {periodShort}
      </div>
      <div className="mt-1.5 text-[15px] font-semibold uppercase tracking-[0.06em] text-[var(--text)]">
        {label}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}


/**
 * The one door from the neutral overview into the evidence. It names the user's
 * purpose — examining the case — not the object being opened.
 */
function ExamineCta({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={open}
      className="hidden w-full items-center gap-3 rounded-[14px] px-4 py-3 text-left transition-colors lg:flex"
      style={{
        border: `1px solid ${open ? "var(--text)" : "var(--border)"}`,
        background: open ? "var(--surface)" : "transparent",
      }}
    >
      <span className="min-w-0">
        <span className="block text-[12px] font-semibold uppercase tracking-[0.12em] text-[var(--text)]">
          {open ? "Close the case" : "Examine the case"}
        </span>
        <span className="mt-0.5 block text-[11px] leading-snug text-[var(--text-muted)]">
          {open
            ? "Return to the market story."
            : "Compare the believers, capital, history, and evidence behind YES and NO."}
        </span>
      </span>
      <span
        aria-hidden
        className="ml-auto text-[15px] text-[var(--text-secondary)] transition-transform"
        style={{ transform: open ? "rotate(90deg)" : "none" }}
      >
        →
      </span>
    </button>
  );
}

/**
 * The viewer's ownership on this market, in human terms: what it's worth now and
 * (when an authoritative cost basis exists) what they put in and their gain. Gain
 * is only ever worth − invested — never a market percentage. Shares live under a
 * quiet "Position details" disclosure, not in the everyday view.
 */
function PositionSummary({
  side,
  pnl,
  tokens,
  onSell,
}: {
  side: OrderSide;
  pnl: PositionPnl;
  tokens: bigint;
  onSell: () => void;
}) {
  const col = side === "YES" ? "var(--yes)" : "var(--no)";
  const hasBasis = pnl.investedUsd != null && pnl.gainUsd != null;
  const gainColor =
    pnl.gainUsd == null
      ? "var(--text-secondary)"
      : pnl.gainUsd > 0
        ? "var(--yes)"
        : pnl.gainUsd < 0
          ? "var(--no)"
          : "var(--text-muted)";
  const [showDetails, setShowDetails] = useState(false);
  const worthStr = pnl.worthUsd != null ? fmtUsd(pnl.worthUsd) : "—";
  return (
    <div className="rounded-[14px] p-3" style={{ border: "1px solid var(--border)" }}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-[var(--text)]">
          Your{" "}
          <span style={{ color: col }} className="font-semibold">
            {side}
          </span>{" "}
          conviction
        </span>
        <button
          type="button"
          onClick={onSell}
          className="shrink-0 rounded-[10px] px-3 py-1 text-[12px] font-semibold text-[var(--text-secondary)]"
          style={{ border: "1px solid var(--border)" }}
        >
          Sell
        </button>
      </div>

      {hasBasis ? (
        <>
          <div className="mt-2 flex items-end gap-6">
            <div>
              <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                Invested
              </div>
              <div className="num text-[16px] font-semibold text-[var(--text)]">
                {fmtUsd(pnl.investedUsd!)}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
                Worth now
              </div>
              <div className="num text-[16px] font-semibold text-[var(--text)]">{worthStr}</div>
            </div>
          </div>
          <div className="num mt-1 text-[12px] font-semibold" style={{ color: gainColor }}>
            {signedUsd(pnl.gainUsd!)} · {signedPct(pnl.gainPct)}
          </div>
        </>
      ) : (
        <div className="mt-2">
          <div className="text-[10px] uppercase tracking-[0.1em] text-[var(--text-muted)]">
            Worth now
          </div>
          <div className="num text-[16px] font-semibold text-[var(--text)]">{worthStr}</div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowDetails((v) => !v)}
        className="mt-2 text-[10px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
      >
        {showDetails ? "Hide details" : "Position details"}
      </button>
      {showDetails && (
        <div className="num mt-1 text-[11px] text-[var(--text-muted)]">
          {fmtShares(tokens)} shares held
        </div>
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
  // Execution mechanics (shares, avg price) live under a disclosure, off by default.
  const [showOrderDetails, setShowOrderDetails] = useState(false);
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
        <AvailRow ethUsd={ethUsd} />
        {/* Human layer: dollars in, protocol fee. Execution mechanics are demoted. */}
        <QuoteRow k="You invest" v={fmtUsd(amount)} />
        {quote && <QuoteRow k="Protocol fee" v={fmtUsd(weiToUsd(quote.fee, ethUsd))} />}
        {trade.isError && (
          <div className="text-[11px] text-[var(--no)]">
            {trade.error?.message?.slice(0, 90) ?? "Transaction failed."}
          </div>
        )}
        {/* Advanced execution layer — shares, average fill, network — on demand. */}
        <button
          type="button"
          onClick={() => setShowOrderDetails((v) => !v)}
          className="pt-0.5 text-[10px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
        >
          {showOrderDetails ? "Hide order details" : "Order details"}
        </button>
        {showOrderDetails && (
          <div className="space-y-1 border-t pt-1" style={{ borderColor: "var(--border)" }}>
            <QuoteRow
              k="You pay"
              v={`${fmtUsd(amount)}  ·  ${(Number(ethWei) / 1e18).toFixed(4)} ETH`}
            />
            <QuoteRow k="Est. shares" v={quoting ? "…" : quote ? fmtShares(quote.tokens) : "—"} />
            <QuoteRow
              k="Avg execution"
              v={quote ? `$${avgPriceUsd(ethWei, quote.tokens, ethUsd).toFixed(2)}` : "—"}
            />
            <QuoteRow k="Network" v="Base" />
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
  worthUsd,
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
  /** Current value of the held side (POV) — for the "position remaining" estimate. */
  worthUsd?: number | null;
  ready: { connected: boolean; onBase: boolean };
  trade: TradeApi;
  onConfirm: () => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  // Token counts live under a disclosure — you sell in human percentages.
  const [showDetails, setShowDetails] = useState(false);
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
  const remainingUsd = worthUsd != null ? worthUsd * (1 - pct / 100) : null;
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
          Sell your{" "}
          <span style={{ color: held.side === "YES" ? "var(--yes)" : "var(--no)" }}>
            {held.side}
          </span>{" "}
          conviction
        </span>
        <span className="ml-auto flex gap-1">
          {[25, 50, 75, 100].map((p) => (
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
        {/* Human layer: dollars out, and what stays in. */}
        <QuoteRow
          k="Estimated proceeds"
          v={quoting ? "…" : proceeds != null ? `≈ ${fmtUsd(weiToUsd(proceeds, ethUsd))}` : "—"}
        />
        {remainingUsd != null && pct < 100 && (
          <QuoteRow k="Position remaining" v={`≈ ${fmtUsd(remainingUsd)}`} />
        )}
        {trade.isError && (
          <div className="text-[11px] text-[var(--no)]">
            {trade.error?.message?.slice(0, 90) ?? "Transaction failed."}
          </div>
        )}
        {/* Token count under a disclosure — you chose a percentage, not a share qty. */}
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          className="pt-0.5 text-[10px] text-[var(--text-muted)] transition-colors hover:text-[var(--text-secondary)]"
        >
          {showDetails ? "Hide order details" : "Order details"}
        </button>
        {showDetails && (
          <div className="border-t pt-1" style={{ borderColor: "var(--border)" }}>
            <QuoteRow k="Shares sold" v={`${fmtShares(shares)} of ${fmtShares(held.tokens)}`} />
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

/** Spendable ETH in the connected wallet, shown in USD above "You pay". */
function AvailRow({ ethUsd }: { ethUsd: number }) {
  const { address, isConnected } = useAccount();
  const { data, isLoading } = useBalance({
    address,
    chainId: CHAIN_ID,
    query: { enabled: !!address, refetchInterval: 20_000 },
  });
  const eth = data ? Number(data.value) / 1e18 : 0;
  const v = !isConnected
    ? "Connect wallet"
    : isLoading || !data
      ? "…"
      : `${fmtUsd(eth * ethUsd)}  ·  ${eth.toFixed(4)} ETH`;
  return <QuoteRow k="Avail" v={v} />;
}

/**
 * Media attached on Conviction (not POV). Rendered from a short-lived signed
 * URL and only for markets whose off-chain row is active and un-hidden.
 */
function ConvictionMedia({ onchainId, title }: { onchainId: number; title: string }) {
  const { data } = useQuery({
    queryKey: ["conviction-market", onchainId],
    queryFn: () => getConvictionMarket({ data: { onchainId } }),
    staleTime: 5 * 60_000,
  });
  const market = data?.market as
    | { media: { kind?: string; url?: string; title?: string } | null; mediaUrl: string | null }
    | null
    | undefined;
  const media = market?.media;
  if (!media?.kind) return null;

  if (media.kind === "link") {
    return (
      <a
        href={media.url}
        target="_blank"
        rel="noreferrer noopener"
        className="block truncate rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-[12px] text-[var(--text-secondary)]"
      >
        {media.title ?? media.url}
      </a>
    );
  }
  const src = market?.mediaUrl;
  if (!src) return null;
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--border)]">
      {media.kind === "image" && (
        <img
          src={src}
          alt={title}
          width={640}
          height={360}
          decoding="async"
          className="max-h-[240px] w-full object-cover"
        />
      )}
      {media.kind === "video" && (
        <video
          src={src}
          controls
          className="max-h-[240px] w-full"
          style={{ aspectRatio: "16 / 9" }}
        />
      )}
      {media.kind === "audio" && <audio src={src} controls className="w-full" />}
    </div>
  );
}
