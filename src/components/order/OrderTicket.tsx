/**
 * Order ticket — the one order component, with modes.
 *
 * The single source of truth for "YES or NO?" and "how much?": the side buttons,
 * the dollar amount field (with its ETH conversion), the wallet balance / Max /
 * minimum line, the quote k/v row, and the primary action button with its wallet
 * and transaction states.
 *
 * `<OrderTicket mode="buy">` and `<OrderTicket mode="sell">` are the market
 * page's two order interactions — there is no BuyOrderBar / SellOrderBar, just one
 * component whose middle changes with the mode while the amount input, wallet
 * state, transaction states, errors and receipts stay shared. The Create Market
 * screen composes the same atoms below (it adds a question + media, so it is not a
 * `mode` — but it reuses AmountField / SideButton / BalanceLine / PrimaryAction).
 */
import { useEffect, useState, type ReactNode } from "react";
import { useAccount, useBalance } from "wagmi";
import { CHAIN_ID } from "@/chain/decoder";
import {
  avgPriceUsd,
  fmtShares,
  fmtUsd,
  sharesForPct,
  weiToUsd,
  type OrderSide,
} from "@/domain/order";
import type { useTrade } from "@/lib/chain-trade";

/** The trade controller the deck owns; the ticket only reads its state + calls it. */
type TradeApi = ReturnType<typeof useTrade>;

/** The connected wallet's spendable ETH on Base — one reader for every order surface. */
export function useSpendableBalance() {
  const { address, isConnected } = useAccount();
  const { data, isLoading } = useBalance({
    address,
    chainId: CHAIN_ID,
    query: { enabled: !!address, refetchInterval: 20_000 },
  });
  const wei = data?.value ?? null;
  const eth = wei != null ? Number(wei) / 1e18 : null;
  return { wei, eth, isConnected, isLoading };
}

/** Dollar input that accepts decimals (e.g. 0.25, 12.50). */
export function AmountField({
  amount,
  setAmount,
  ariaLabel = "Amount in dollars",
}: {
  amount: number;
  setAmount: (n: number) => void;
  ariaLabel?: string;
}) {
  const [text, setText] = useState(amount ? String(amount) : "");

  // Re-sync when the amount is changed from the outside (Max, min default, draft).
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
        aria-label={ariaLabel}
        className="num w-[86px] bg-transparent text-[18px] font-semibold text-[var(--text)] outline-none"
        placeholder="0"
      />
    </span>
  );
}

/**
 * Quick-amount chips — the PRIMARY, mouse-first way to choose how much to back.
 * One click sets the dollar amount; Max fills to the spendable balance. Typing
 * (AmountField) stays available as the secondary path. The active preset lights
 * up so the current amount is always obvious at a glance.
 */
const AMOUNT_PRESETS = [5, 10, 25, 50, 100];
export function AmountChips({
  amount,
  setAmount,
  ethUsd,
}: {
  amount: number;
  setAmount: (n: number) => void;
  ethUsd: number;
}) {
  const { wei, isConnected } = useSpendableBalance();
  const availUsd = wei != null && ethUsd > 0 ? (Number(wei) / 1e18) * ethUsd : null;
  const chip = (label: string, value: number, active: boolean) => (
    <button
      key={label}
      type="button"
      onClick={() => setAmount(value)}
      className="rounded-[10px] px-3.5 py-2 text-[14px] font-semibold tabular-nums transition-colors"
      style={
        active
          ? { background: "var(--text)", color: "var(--bg)" }
          : { border: "1px solid var(--border)", color: "var(--text-secondary)" }
      }
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      {AMOUNT_PRESETS.map((p) => chip(`$${p}`, p, amount === p))}
      {isConnected &&
        availUsd != null &&
        availUsd >= 1 &&
        chip("Max", Math.floor(availUsd * 100) / 100, false)}
    </div>
  );
}

/**
 * A side button. Two looks from one control so both screens share the exact YES/NO
 * vocabulary:
 *   • momentary (selected omitted) — the market dock's tap-to-open NO / YES.
 *   • toggle (selected set) — the create screen's persistent YES ∕ NO choice.
 */
export function SideButton({
  label,
  tone,
  selected,
  onClick,
  className = "h-[52px] flex-1",
}: {
  label: string;
  tone: "yes" | "no" | "pass";
  /** Omit for the momentary market-dock look; set for a persistent toggle. */
  selected?: boolean;
  onClick: () => void;
  className?: string;
}) {
  const accent =
    tone === "yes" ? "var(--yes)" : tone === "no" ? "var(--no)" : "var(--text-secondary)";
  let style: React.CSSProperties;
  if (selected === undefined) {
    // Momentary: surface + colored text (the dock's neutral row).
    style =
      tone === "pass"
        ? { border: "1px solid var(--border)", color: "var(--text-secondary)" }
        : {
            border: "1px solid var(--border-strong,var(--border))",
            background: "var(--surface)",
            color: accent,
          };
  } else if (selected) {
    style = { border: `1px solid ${accent}`, color: accent, background: "var(--surface)" };
  } else {
    style = { border: "1px solid var(--border)", color: "var(--text-muted)" };
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`${className} rounded-[12px] text-[14px] font-semibold transition-colors`}
      style={style}
    >
      {label}
    </button>
  );
}

/** A quiet key/value line inside a quote or ticket. */
export function QuoteRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[11px] text-[var(--text-muted)]">{k}</span>
      <span className="num text-[12px] font-semibold text-[var(--text-secondary)]">{v}</span>
    </div>
  );
}

/**
 * Balance / minimum line: spendable balance on the right (with an optional Max),
 * the contract minimum on the left. Reads the wallet itself so no screen repeats
 * the balance math.
 */
export function BalanceLine({
  ethUsd,
  minWei,
  onMax,
}: {
  ethUsd: number;
  /** The contract's minimum seed, when there is one. */
  minWei?: bigint | null;
  /** When given, a Max chip fills the amount to the spendable balance. */
  onMax?: () => void;
}) {
  const { wei, isConnected } = useSpendableBalance();
  const availUsd = wei != null && ethUsd > 0 ? (Number(wei) / 1e18) * ethUsd : null;
  const minUsd = minWei != null && ethUsd > 0 ? (Number(minWei) / 1e18) * ethUsd : null;
  return (
    <div className="flex items-center justify-between text-[11px] text-[var(--text-muted)]">
      <span>{minUsd != null ? `Min ${fmtUsd(minUsd)}` : " "}</span>
      <span className="num flex items-center gap-2">
        {onMax && isConnected && wei != null && wei > 0n && (
          <button
            type="button"
            onClick={onMax}
            className="rounded-[6px] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-secondary)] transition-colors hover:text-[var(--text)]"
            style={{ border: "1px solid var(--border)" }}
          >
            Max
          </button>
        )}
        <span>{availUsd != null ? `Avail ${fmtUsd(availUsd)}` : "Avail —"}</span>
      </span>
    </div>
  );
}

/** The one primary action — a full-width solid button that carries its own state label. */
export function PrimaryAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label?: string;
  onClick: () => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="h-[52px] w-full rounded-[12px] text-[15px] font-semibold transition-opacity disabled:opacity-40"
      style={{ background: "var(--text)", color: "var(--bg)" }}
    >
      {children ?? label}
    </button>
  );
}

/** Spendable ETH in the connected wallet, shown in USD above "You pay". */
function AvailRow({ ethUsd }: { ethUsd: number }) {
  const { eth, isConnected, isLoading } = useSpendableBalance();
  const v = !isConnected
    ? "Connect wallet"
    : isLoading || eth == null
      ? "…"
      : `${fmtUsd(eth * ethUsd)}  ·  ${eth.toFixed(4)} ETH`;
  return <QuoteRow k="Avail" v={v} />;
}

interface BuyTicketProps {
  side: OrderSide | null;
  amount: number;
  setAmount: (n: number) => void;
  onSelect: (s: OrderSide) => void;
  onCancel: () => void;
  onPass: () => void;
  quote: { tokens: bigint; fee: bigint; refund: bigint } | null;
  quoting: boolean;
  ethWei: bigint;
  ethUsd: number;
  ready: { connected: boolean; onBase: boolean };
  trade: TradeApi;
  onConfirm: () => void;
  onDone: () => void;
}

interface SellTicketProps {
  held: { side: OrderSide; tokens: bigint };
  pct: number;
  setPct: (n: number) => void;
  proceeds: bigint | null;
  quoting: boolean;
  ethUsd: number;
  /** Current value of the held side — for the "position remaining" estimate. */
  worthUsd?: number | null;
  ready: { connected: boolean; onBase: boolean };
  trade: TradeApi;
  onConfirm: () => void;
  onCancel: () => void;
  onDone: () => void;
}

/**
 * The one order component. `mode` switches the middle — a side selector + quote to
 * BUY, a percentage + proceeds to SELL — while the amount input, wallet/Base
 * states, error line, receipt and confirm button behave identically. Create Market
 * is not a mode (it is a whole screen) but composes the same atoms above.
 */
export type OrderTicketProps =
  | ({ mode: "buy" } & BuyTicketProps)
  | ({ mode: "sell" } & SellTicketProps);

export function OrderTicket(p: OrderTicketProps) {
  return p.mode === "buy" ? <BuyTicket {...p} /> : <SellTicket {...p} />;
}

function BuyTicket({
  side,
  amount,
  setAmount,
  onSelect,
  onCancel,
  onPass,
  quote,
  quoting,
  ethWei,
  ethUsd,
  ready,
  trade,
  onConfirm,
  onDone,
}: BuyTicketProps) {
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
            style={{ background: "var(--surface)" }}
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

  // Neutral: choose how much (one click), then which side (big targets).
  if (!side) {
    return (
      <div
        className="space-y-3.5 rounded-[18px] p-4"
        style={{ border: "1px solid var(--border)" }}
      >
        {/* Amount — one-click chips (primary), typing (secondary, to the right). */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <AmountChips amount={amount} setAmount={setAmount} ethUsd={ethUsd} />
          <span className="ml-auto flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
              or type
            </span>
            {amtField}
          </span>
        </div>
        {/* The decision — big, obvious, mouse-first. */}
        <div className="flex gap-2.5">
          <SideButton
            label="← NO"
            tone="no"
            onClick={() => onSelect("NO")}
            className="h-[60px] flex-1"
          />
          <SideButton label="PASS" tone="pass" onClick={onPass} className="h-[60px] w-[104px]" />
          <SideButton
            label="YES →"
            tone="yes"
            onClick={() => onSelect("YES")}
            className="h-[60px] flex-1"
          />
        </div>
      </div>
    );
  }

  // Belief expressed → optional financial backing. Nothing happens without confirm.
  const confirmLabel = !ready.connected
    ? "Connect wallet"
    : !ready.onBase
      ? "Switch to Base"
      : `Back ${side} · ${fmtUsd(amount)}`;
  const disabled = ready.connected && ready.onBase && (busy || !quote || ethWei <= 0n);

  return (
    <div className="rounded-[18px] p-4" style={{ border: "1px solid var(--border)" }}>
      <div className="mb-3 space-y-1 px-1">
        <div className="pb-1 text-[12px] font-semibold text-[var(--text)]">
          Back {side} to reveal the House’s pick.
        </div>
        <AvailRow ethUsd={ethUsd} />
        <QuoteRow k="You invest" v={fmtUsd(amount)} />
        {quote && <QuoteRow k="Protocol fee" v={fmtUsd(weiToUsd(quote.fee, ethUsd))} />}
        {trade.isError && (
          <div className="text-[11px] text-[var(--no)]">
            {trade.error?.message?.slice(0, 90) ?? "Transaction failed."}
          </div>
        )}
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
      <div className="space-y-3">
        {/* Amount — one-click chips (primary), typing (secondary). */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <AmountChips amount={amount} setAmount={setAmount} ethUsd={ethUsd} />
          <span className="ml-auto flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
              or type
            </span>
            {amtField}
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            className="h-[56px] flex-1 rounded-[12px] text-[14px] font-medium text-[var(--text-secondary)]"
            style={{ border: "1px solid var(--border)" }}
          >
            Not now
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={onConfirm}
            className="h-[56px] flex-[2] rounded-[12px] text-[15px] font-semibold disabled:opacity-40"
            style={{ background: "var(--text)", color: "var(--bg)" }}
          >
            {busy ? "Confirming…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function SellTicket({
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
}: SellTicketProps) {
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
