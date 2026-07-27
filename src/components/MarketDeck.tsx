/**
 * CENTER — single-market decision deck.
 *
 * One market at a time: Pulse (why now) → Battlefield (both sides) → your DNA
 * evidence → a persistent dock (shared amount, NO / SKIP / YES). A gesture/button/
 * key only SELECTS a side; buying requires an explicit Confirm after an on-chain
 * quote. Prices/quotes come from the contract (src/lib/chain-trade) — never the
 * client. Skip has no financial effect and just advances the queue.
 */
import { useEffect, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useSwitchChain } from "wagmi";
import type { MarketRow } from "@/components/MarketCard";
import { CHAIN_ID } from "@/chain/decoder";
import { useBuyQuote, useTrade, useTradeReady, useUserBalance } from "@/lib/chain-trade";
import {
  pulseFor,
  usdToWei,
  avgPriceUsd,
  fmtShares,
  fmtUsd,
  selectSide,
  type OrderSide,
} from "@/domain/order";

const PULSE_TONE: Record<string, string> = {
  hot: "#f59e0b",
  warm: "var(--top-voice, #d7ae58)",
  neutral: "var(--text-muted)",
};

export function MarketDeck({
  row,
  ethUsd,
  onSkip,
}: {
  row: MarketRow;
  ethUsd: number;
  onSkip: () => void;
}) {
  const rr = row as Record<string, unknown>;
  const marketId = Number(row.onchain_id);
  const title = row.markets?.title ?? `Market #${marketId}`;
  const category = row.markets?.category ?? null;
  const pulse = pulseFor(
    (rr.opportunity_type as string | null) ?? null,
    (rr.opportunity_reason as string | null) ?? null,
  );

  const [amount, setAmount] = useState(20);
  const [side, setSide] = useState<OrderSide | null>(null);

  const { openConnectModal } = useConnectModal();
  const { switchChain } = useSwitchChain();
  const ready = useTradeReady();
  const trade = useTrade();
  const bal = useUserBalance(marketId);

  const ethWei = usdToWei(amount, ethUsd);
  const { quote, isLoading: quoting } = useBuyQuote(marketId, side === "YES", side ? ethWei : 0n);

  // Reset the order when the market changes.
  useEffect(() => {
    setSide(null);
    trade.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketId]);

  // Keyboard: ←/→ select, ↑ skip (never buys).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el && ["INPUT", "TEXTAREA"].includes(el.tagName)) return;
      if (e.key === "ArrowLeft") setSide((s) => selectSide(s, "NO"));
      else if (e.key === "ArrowRight") setSide((s) => selectSide(s, "YES"));
      else if (e.key === "ArrowUp") {
        e.preventDefault();
        onSkip();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSkip]);

  const relationshipBeat = row.story?.beats.find((b) => b.kind === "relationship")?.text ?? null;
  const eventBeat = row.story?.beats.find((b) => b.kind === "event")?.text ?? null;
  const held =
    bal.yes > 0n
      ? { side: "YES" as const, tokens: bal.yes }
      : bal.no > 0n
        ? { side: "NO" as const, tokens: bal.no }
        : null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Identity */}
      <div>
        {category && (
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-muted)]">
            {category}
          </div>
        )}
        <h1 className="text-[clamp(20px,2.4vw,30px)] font-semibold leading-tight tracking-tight text-[var(--text)]">
          {title}
        </h1>
      </div>

      {/* Pulse — why this matters now */}
      <div
        className="flex items-center gap-2 rounded-[12px] px-3 py-2.5"
        style={{ border: "1px solid var(--border)" }}
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: PULSE_TONE[pulse.tone] }}
          aria-hidden
        />
        <span className="text-[13px] font-semibold text-[var(--text)]">Pulse: {pulse.label}</span>
        <span className="min-w-0 truncate text-[12px] text-[var(--text-secondary)]">
          {pulse.why}
        </span>
      </div>

      {/* Battlefield */}
      <div className="grid min-h-0 grid-cols-2 gap-2">
        <SideCard
          label="YES"
          price={row.yes_price_usd}
          chg={row.chg_window_yes ?? row.chg_24h_yes ?? null}
          believers={row.believers_yes}
          capital={row.yes_capital_usd ?? null}
          selected={side === "YES"}
          onSelect={() => setSide((s) => selectSide(s, "YES"))}
        />
        <SideCard
          label="NO"
          price={row.no_price_usd}
          chg={row.chg_window_no ?? row.chg_24h_no ?? null}
          believers={row.believers_no}
          capital={row.no_capital_usd ?? null}
          selected={side === "NO"}
          onSelect={() => setSide((s) => selectSide(s, "NO"))}
        />
      </div>

      {/* DNA / social evidence + recent activity */}
      <div className="space-y-1.5">
        <div className="flex items-start gap-2 text-[13px]">
          <span
            className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: "var(--rel,#9b87f5)" }}
            aria-hidden
          />
          <span className="text-[var(--text-secondary)]">
            {relationshipBeat ?? "No reliable DNA signal here yet."}
          </span>
        </div>
        {eventBeat && (
          <div className="pl-3.5 text-[12px] text-[var(--text-muted)]">{eventBeat}</div>
        )}
      </div>

      {held && (
        <div className="text-[12px] text-[var(--text-muted)]">
          You already hold <b className="text-[var(--text)]">{held.side}</b> ·{" "}
          {fmtShares(held.tokens)} shares
        </div>
      )}

      {/* Decision dock */}
      <div className="mt-auto">
        <Dock
          side={side}
          amount={amount}
          setAmount={setAmount}
          onSelect={(s) => setSide((cur) => selectSide(cur, s))}
          onSkip={onSkip}
          quote={quote}
          quoting={quoting}
          ethWei={ethWei}
          ethUsd={ethUsd}
          ready={ready}
          trade={trade}
          onConfirm={async () => {
            if (!ready.connected) return openConnectModal?.();
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
      </div>
    </div>
  );
}

function SideCard({
  label,
  price,
  chg,
  believers,
  capital,
  selected,
  onSelect,
}: {
  label: OrderSide;
  price: number | null;
  chg: number | null;
  believers: number | null;
  capital: number | null;
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
        border: `1.5px solid ${selected ? col : "var(--border)"}`,
        background: selected
          ? `color-mix(in oklab, ${col} 12%, transparent)`
          : `color-mix(in oklab, ${col} 5%, transparent)`,
      }}
    >
      <div className="text-[11px] font-semibold tracking-wide" style={{ color: col }}>
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="num text-[22px] font-semibold leading-none text-[var(--text)]">
          {price == null ? "—" : `$${Number(price).toFixed(2)}`}
        </span>
        {chg != null && Number.isFinite(chg) && (
          <span
            className="num text-[11px] font-semibold"
            style={{ color: chg >= 0 ? "var(--yes)" : "var(--no)" }}
          >
            {chg >= 0 ? "+" : "−"}
            {Math.abs(chg).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="num text-[11px] text-[var(--text-muted)]">
        {believers ?? 0} believers{capital ? ` · ${fmtUsd(capital)}` : ""}
      </div>
    </button>
  );
}

type TradeApi = ReturnType<typeof useTrade>;

function Dock({
  side,
  amount,
  setAmount,
  onSelect,
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
              background:
                side === "YES"
                  ? "color-mix(in oklab,var(--yes) 18%,transparent)"
                  : "color-mix(in oklab,var(--no) 18%,transparent)",
            }}
          >
            <span style={{ color: side === "YES" ? "var(--yes)" : "var(--no)" }}>✓</span>
          </span>
          <div>
            <div className="text-[15px] font-semibold text-[var(--text)]">Joined {side}</div>
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
  const amtField = (
    <span
      className="flex h-[52px] items-center gap-1 rounded-[12px] px-3"
      style={{ border: "1px solid var(--border)" }}
    >
      <span className="num text-[15px] text-[var(--text-muted)]">$</span>
      <input
        inputMode="numeric"
        value={amount ? amount.toLocaleString("en-US") : ""}
        onChange={(e) => {
          const v = parseInt(e.target.value.replace(/[^0-9]/g, ""), 10);
          setAmount(Number.isNaN(v) ? 0 : Math.min(v, 1_000_000));
        }}
        aria-label="Amount in dollars"
        className="num w-[86px] bg-transparent text-[18px] font-semibold text-[var(--text)] outline-none"
        placeholder="0"
      />
    </span>
  );

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

  // Selected → review + Confirm / Cancel.
  const confirmLabel = !ready.connected
    ? "Connect wallet"
    : !ready.onBase
      ? "Switch to Base"
      : `Confirm ${side} · ${fmtUsd(amount)}`;
  // Disabled only once connected + on Base but the quote isn't ready.
  const disabled = ready.connected && ready.onBase && (busy || !quote || ethWei <= 0n);

  return (
    <div className="rounded-[16px] p-3" style={{ border: "1px solid var(--border)" }}>
      {/* Quote review */}
      <div className="mb-2 space-y-1 px-1">
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
            onClick={() => onSelect(side)}
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
            style={{
              background: side === "YES" ? "var(--yes)" : "var(--no)",
              color: side === "YES" ? "#062815" : "#2d0808",
            }}
          >
            {busy ? "Confirming…" : confirmLabel}
          </button>
        </div>
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
          border: "1px solid color-mix(in oklab,var(--yes) 45%,transparent)",
          background: "color-mix(in oklab,var(--yes) 10%,transparent)",
          color: "var(--yes)",
        }
      : tone === "no"
        ? {
            border: "1px solid color-mix(in oklab,var(--no) 45%,transparent)",
            background: "color-mix(in oklab,var(--no) 10%,transparent)",
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
