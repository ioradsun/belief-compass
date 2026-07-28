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
import { MarketEvidence } from "@/components/MarketEvidence";
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

  const { openConnectModal } = useConnectModal();
  const { switchChain } = useSwitchChain();
  const ready = useTradeReady();
  const trade = useTrade();
  const bal = useUserBalance(marketId);

  const ethWei = usdToWei(amount, ethUsd);
  const { quote, isLoading: quoting } = useBuyQuote(marketId, side === "YES", side ? ethWei : 0n);

  // Reset both flows when the market changes.
  useEffect(() => {
    setSide(null);
    setSellPct(null);
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
    if (!ready.connected) return openConnectModal?.();
    if (!ready.onBase) return switchChain({ chainId: CHAIN_ID });
    if (held && proceeds != null && sellShares > 0n && !(trade.isSubmitting || trade.isMining)) {
      try {
        await trade.sell(marketId, held.side === "YES", sellShares, proceeds);
      } catch {
        /* surfaced via trade.error */
      }
    }
  };

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
          {/* Deep link to the market's own page on POV, for anyone who'd rather
              trade there with their POV wallet. */}
          <a
            href={povUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto rounded-full px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text)]"
            style={{ border: "1px solid var(--border)" }}
          >
            Trade on POV ↗
          </a>
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


        {/* Evidence: believers · price · defense */}
        <MarketEvidence marketId={marketId} />

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
        ) : (
          <Dock
            side={side}
            amount={amount}
            setAmount={setAmount}
            onSelect={(s) => {
              trade.reset();
              setSide((cur) => selectSide(cur, s));
            }}
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
        )}
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
              background: "var(--surface)",
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
