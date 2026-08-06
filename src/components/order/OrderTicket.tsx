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
import { avgPriceUsd, fmtShares, fmtUsd, sharesForPct, type OrderSide } from "@/domain/order";
import { formatMoney, type DisplayUnit, weiToEth, convertMoney } from "@/domain/money";
import { affordability, affordabilityCopy } from "@/domain/affordability";
import { useDisplayUnit } from "@/lib/display-unit";
import type { useTrade } from "@/lib/chain-trade";

/** The trade controller the deck owns; the ticket only reads its state + calls it. */
type TradeApi = ReturnType<typeof useTrade>;

// ONE control system for every order surface — Buy, Buy More, Sell, Create and
// their Cancel / confirm / receipt bars all use the same height, radius and
// button language, so moving between them never resizes or shocks.
const CTRL = "h-[52px] rounded-[12px]"; // every button + the amount field
const CARD = "rounded-[16px] p-3.5"; // every ticket container
const PRIMARY_STYLE = { background: "var(--text)", color: "var(--bg)" } as const;
const GHOST_STYLE = { border: "1px solid var(--border)" } as const;
// Containers carry no border: a fill one step above the panel does the grouping,
// so the only lines on screen belong to things you can actually press or type in.
const CARD_STYLE = { background: "var(--surface)" } as const;

/** The connected wallet's spendable ETH on Base — one reader for every order surface. */
export function useSpendableBalance() {
  const { address, isConnected } = useAccount();
  const { data, isLoading } = useBalance({
    address,
    chainId: CHAIN_ID,
    query: { enabled: !!address, refetchInterval: 20_000 },
  });
  const wei = data?.value ?? null;
  const eth = wei != null ? weiToEth(wei) : null;
  return { wei, eth, isConnected, isLoading };
}

/** Trim an ETH amount to at most `dp` decimals (default 6) for display/entry. */
function ethText(eth: number, dp = 6): string {
  if (!Number.isFinite(eth) || eth === 0) return "";
  const s = eth.toFixed(dp);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
}

/**
 * The amount input. `amount` is ALWAYS the USD value — the trade-sizing pipeline
 * (usdToWei) is unchanged — but when the viewer's display unit is ETH the field
 * shows and accepts ETH, converting to USD at the boundary through the one rate.
 * The USD value never round-trips through the field, so trade math is untouched.
 */
export function AmountField({
  amount,
  setAmount,
  unit = "USD",
  ethUsd = 0,
  ariaLabel = "Amount",
  grow = false,
}: {
  amount: number;
  setAmount: (n: number) => void;
  unit?: DisplayUnit;
  ethUsd?: number;
  ariaLabel?: string;
  /** Fill the row width (the order form) rather than a fixed field (Create). */
  grow?: boolean;
}) {
  const eth = unit === "ETH";
  const decimals = eth ? 6 : 2;
  const toUsd = (v: number) => (eth ? (ethUsd > 0 ? v * ethUsd : 0) : v);
  const toDisplayText = (usd: number) =>
    usd ? (eth ? ethText(ethUsd > 0 ? usd / ethUsd : 0) : String(usd)) : "";

  const [text, setText] = useState(() => toDisplayText(amount));

  // Re-sync when the external amount changes (Max, min default, draft) OR the
  // display unit flips. Compare in USD with a tolerance so the viewer's own
  // keystrokes are never clobbered, and a live-rate tick (not a dep) can't reset
  // the field mid-type.
  useEffect(() => {
    const impliedUsd = toUsd(parseFloat(text));
    const same = Math.abs((Number.isNaN(impliedUsd) ? 0 : impliedUsd) - amount) < 0.005;
    if (!same) setText(toDisplayText(amount));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, unit]);

  return (
    <span
      className={`flex ${CTRL} items-center gap-1.5 px-3.5 ${grow ? "flex-1" : ""}`}
      style={GHOST_STYLE}
    >
      <span className="num text-[16px] text-[var(--text-muted)]">{eth ? "Ξ" : "$"}</span>
      <input
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          // Keep digits and a single decimal point, capped to the unit's precision.
          let raw = e.target.value.replace(/[^0-9.]/g, "");
          const first = raw.indexOf(".");
          if (first !== -1) {
            raw = raw.slice(0, first + 1) + raw.slice(first + 1).replace(/\./g, "");
            const [int, dec] = raw.split(".");
            raw = `${int}.${(dec ?? "").slice(0, decimals)}`;
          }
          const n = parseFloat(raw);
          const usd = Number.isNaN(n) ? 0 : toUsd(n);
          // The $1,000,000 ceiling is enforced on the USD value in either unit.
          if (usd > 1_000_000) {
            setText(toDisplayText(1_000_000));
            setAmount(1_000_000);
            return;
          }
          setText(raw);
          setAmount(usd);
        }}
        onBlur={() => setText(toDisplayText(amount))}
        aria-label={ariaLabel}
        className={`num bg-transparent text-[18px] font-semibold text-[var(--text)] outline-none ${grow ? "w-full flex-1" : "w-[96px]"}`}
        placeholder="0"
      />
    </span>
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
  sub,
  tone,
  selected,
  onClick,
  className = "h-[52px] flex-1",
}: {
  label: string;
  /** A quiet second line inside the button, e.g. "$24.10 owned" on Sell. */
  sub?: string | null;
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
      className={`${className} flex flex-col items-center justify-center rounded-[12px] px-2 text-[14px] font-semibold leading-tight transition-colors`}
      style={style}
    >
      <span className="min-w-0 truncate">{label}</span>
      {sub && <span className="num mt-0.5 text-[10px] font-medium opacity-70">{sub}</span>}
    </button>
  );
}

/**
 * THE one action row. Every selector in the dock — the neutral decision, the
 * owned Buy/Sell/Pass bar, and both morphed side-pickers — renders through this,
 * so the footprint, height and spacing never change between states. Three equal
 * columns: the layout is spatially stable, whatever you own.
 */
export function ActionRow({ children }: { children: ReactNode }) {
  return (
    <div className={`${CARD} flex gap-2`} style={CARD_STYLE}>
      {children}
    </div>
  );
}

/**
 * "You own" — ownership as CONTEXT above the controls, never as the thing that
 * decides them. Shows every side actually held, so holding both is visible.
 *
 * The VALUE leads, the side follows — "You own $234 YES" — because what a
 * position is worth in your own currency is the fact you read first; which side
 * it is on you already know. `yes`/`no` are pre-formatted money strings.
 */
export function OwnedLine({ yes, no }: { yes?: string | null; no?: string | null }) {
  if (!yes && !no) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-1 pb-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-muted)]">
        You own
      </span>
      {yes && (
        <span className="num text-[12px] font-semibold text-[var(--text)]">
          {yes} <span style={{ color: "var(--yes)" }}>YES</span>
        </span>
      )}
      {no && (
        <span className="num text-[12px] font-semibold text-[var(--text)]">
          {no} <span style={{ color: "var(--no)" }}>NO</span>
        </span>
      )}
    </div>
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
  const availUsd = wei == null ? null : convertMoney(weiToEth(wei), "ETH", "USD", ethUsd);
  const minUsd = minWei == null ? null : convertMoney(weiToEth(minWei), "ETH", "USD", ethUsd);
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
      : `${fmtUsd(eth * ethUsd)}  ·  \u039E${eth.toFixed(4)}`;
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

/**
 * Amount in the viewer's currency, from a USD-native value.
 * USD → `$1.00`; ETH → `0.0005 ETH` (no scientific notation, no trailing zeros).
 */
function unitAmount(usd: number, unit: DisplayUnit, ethUsd: number): string {
  if (unit === "USD")
    return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (!(ethUsd > 0)) return "—";
  return `${ethText(usd / ethUsd, 8) || "0"} ETH`;
}

/** Amount in the viewer's currency, from an ETH-native value. */
function unitAmountFromEth(eth: number, unit: DisplayUnit, ethUsd: number): string {
  if (unit === "ETH") return `${ethText(eth, 8) || "0"} ETH`;
  if (!(ethUsd > 0)) return "—";
  return unitAmount(eth * ethUsd, "USD", ethUsd);
}

/**
 * The amount, as the primary object in the form: a large tabular figure with the
 * currency indicator, a hairline underline and no nested field.
 */
function BigAmount({
  amount,
  setAmount,
  unit,
  ethUsd,
  error,
}: {
  amount: number;
  setAmount: (n: number) => void;
  unit: DisplayUnit;
  ethUsd: number;
  error?: string | null;
}) {
  const eth = unit === "ETH";
  const decimals = eth ? 8 : 2;
  const toUsd = (v: number) => (eth ? (ethUsd > 0 ? v * ethUsd : 0) : v);
  const toText = (usd: number) =>
    usd ? (eth ? ethText(ethUsd > 0 ? usd / ethUsd : 0, 8) : String(usd)) : "";
  const [text, setText] = useState(() => toText(amount));
  const [focus, setFocus] = useState(false);

  useEffect(() => {
    const implied = toUsd(parseFloat(text));
    if (Math.abs((Number.isNaN(implied) ? 0 : implied) - amount) >= 0.005) setText(toText(amount));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, unit]);

  return (
    <div
      className="flex items-baseline gap-2 pb-2 transition-colors"
      style={{
        borderBottom: `1px solid ${error ? "var(--loss)" : focus ? "var(--text)" : "var(--border)"}`,
      }}
    >
      {!eth && <span className="num text-[26px] font-medium text-[var(--text-muted)]">$</span>}
      <input
        inputMode="decimal"
        value={text}
        onFocus={() => setFocus(true)}
        onBlur={() => {
          setFocus(false);
          setText(toText(amount));
        }}
        onChange={(e) => {
          let raw = e.target.value.replace(/[^0-9.]/g, "");
          const first = raw.indexOf(".");
          if (first !== -1) {
            raw = raw.slice(0, first + 1) + raw.slice(first + 1).replace(/\./g, "");
            const [int, dec] = raw.split(".");
            raw = `${int}.${(dec ?? "").slice(0, decimals)}`;
          }
          const n = parseFloat(raw);
          const usd = Number.isNaN(n) ? 0 : toUsd(n);
          if (usd > 1_000_000) {
            setText(toText(1_000_000));
            setAmount(1_000_000);
            return;
          }
          setText(raw);
          setAmount(usd);
        }}
        aria-label={`Amount to back in ${unit}`}
        aria-invalid={!!error}
        placeholder="0"
        className="num min-w-0 flex-1 bg-transparent text-[30px] font-semibold leading-none text-[var(--text)] outline-none [font-variant-numeric:tabular-nums]"
      />
      {eth && <span className="text-[15px] font-medium text-[var(--text-muted)]">ETH</span>}
    </div>
  );
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
  const { unit } = useDisplayUnit();
  const money = (usd: number) => unitAmount(usd, unit, ethUsd);
  const fromEth = (eth: number) => unitAmountFromEth(eth, unit, ethUsd);
  const busy = trade.isSubmitting || trade.isMining;
  const [details, setDetails] = useState(false);
  const { eth: availEth } = useSpendableBalance();
  // One binding for both places this ticket shows it — including the receipt,
  // which returns early above the form. Null when there is no quote or no rate:
  // "$0.00 avg" on a real trade is a claim about the price, and a missing rate
  // is not one.
  const avgPrice = quote ? avgPriceUsd(ethWei, quote.tokens, ethUsd) : null;

  // Escape dismisses the order surface, like any other disclosure.
  useEffect(() => {
    if (!side) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [side, onCancel]);

  // Receipt — same footprint as the form, so nothing resizes on success.
  if (trade.isSuccess && side) {
    return (
      <div className={CARD} style={CARD_STYLE}>
        <div className="mb-3 flex items-center gap-3 px-0.5">
          <span
            className="grid h-7 w-7 place-items-center rounded-full"
            style={{ background: "var(--surface)" }}
          >
            <span style={{ color: side === "YES" ? "var(--yes)" : "var(--no)" }}>✓</span>
          </span>
          <div>
            <div className="text-[14px] font-semibold text-[var(--text)]">Backed {side}</div>
            {quote && (
              <div className="num text-[11px] text-[var(--text-muted)]">
                {fmtShares(quote.tokens)} shares
                {avgPrice == null ? "" : ` at $${avgPrice.toFixed(2)} avg`}
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onDone}
          className={`${CTRL} w-full text-[15px] font-semibold`}
          style={PRIMARY_STYLE}
        >
          Next market
        </button>
      </div>
    );
  }

  // Neutral: the decision only — one tap on an action opens the order form.
  // YES left, NO right, Pass last: the same three equal columns every other
  // selector uses, so nothing shifts as the dock morphs.
  if (!side) {
    return (
      <ActionRow>
        <SideButton
          label="Back YES"
          tone="yes"
          onClick={() => onSelect("YES")}
          className={`${CTRL} flex-1`}
        />
        <SideButton
          label="Back NO"
          tone="no"
          onClick={() => onSelect("NO")}
          className={`${CTRL} flex-1`}
        />
        <SideButton label="Pass" tone="pass" onClick={onPass} className={`${CTRL} flex-1`} />
      </ActionRow>
    );
  }

  const availUnit = availEth == null ? null : unitAmountFromEth(availEth, unit, ethUsd);
  // One rule, and it fails closed — see @/domain/affordability. The check this
  // replaces compared the amount to the FULL balance (no room for the network
  // fee), said only "Insufficient balance", and switched itself off entirely
  // when the ETH/USD rate was missing.
  const afford = affordability({ amountUsd: amount, balanceEth: availEth, ethUsd });
  const affordCopy = affordabilityCopy(afford);
  const overBalance = !afford.ok;
  const amountError = amount <= 0 ? null : (affordCopy?.detail ?? null);

  const label = !ready.connected
    ? "Connect wallet"
    : !ready.onBase
      ? "Switch to Base"
      : busy
        ? `Backing ${side}…`
        : amount <= 0
          ? "Enter an amount"
          : affordCopy
            ? affordCopy.label
            : `Back ${side} · ${money(amount)}`;
  const disabled =
    ready.connected &&
    ready.onBase &&
    (busy || !quote || ethWei <= 0n || amount <= 0 || overBalance);

  return (
    <div className="rounded-[16px] p-5 sm:p-[22px]" style={CARD_STYLE}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-[var(--text)]">Back {side}</h3>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close order"
          className="-mr-1 grid h-7 w-7 place-items-center rounded-[8px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text)]"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path
              d="M2 2l10 10M12 2L2 12"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div className="mt-4">
        <BigAmount
          amount={amount}
          setAmount={setAmount}
          unit={unit}
          ethUsd={ethUsd}
          error={amountError}
        />
        <div className="mt-1.5 text-[12px] text-[var(--text-muted)]">
          {amountError ? (
            <span style={{ color: "var(--loss)" }}>
              {amountError} · Available {availUnit ?? "—"}
            </span>
          ) : (
            <>Available {availUnit ?? "—"}</>
          )}
        </div>
      </div>

      <div className="mt-5 flex items-baseline justify-between gap-3 text-[12px]">
        <span className="num min-w-0 truncate text-[var(--text-secondary)]">
          {quoting || !quote
            ? "Calculating…"
            : `≈ ${fmtShares(quote.tokens)} shares · ${fromEth(weiToEth(quote.fee))} fee`}
        </span>
        <button
          type="button"
          onClick={() => setDetails((d) => !d)}
          aria-expanded={details}
          aria-controls="order-details"
          className="shrink-0 text-[12px] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text)]"
        >
          Details
        </button>
      </div>

      {details && (
        <div id="order-details" className="mt-3 space-y-1.5">
          <QuoteRow k="Amount invested" v={money(amount)} />
          <QuoteRow k="Estimated shares" v={quote ? fmtShares(quote.tokens) : "—"} />
          <QuoteRow k="Avg execution" v={avgPrice == null ? "—" : `$${avgPrice.toFixed(2)}`} />
          <QuoteRow k="Protocol fee" v={quote ? fromEth(weiToEth(quote.fee)) : "—"} />
          <QuoteRow k="Total paid" v={fromEth(weiToEth(ethWei))} />
          <QuoteRow k="Network" v="Base" />
        </div>
      )}

      {trade.isError && (
        <div className="mt-2 text-[11px]" role="alert" style={{ color: "var(--loss)" }}>
          {/* Never a bare "Transaction failed" when we do not know that it
              failed — that is the sentence that makes a reader submit again.
              An error we cannot name is an error we say we cannot name. */}
          {trade.error?.message?.slice(0, 120) ??
            "We didn't get a result back. Check your wallet before trying again."}
        </div>
      )}

      {/* THE TWO ANXIOUS STATES, told apart. They shared one label — "Backing
          YES…" — which answered neither of the questions a person actually has
          at each: has my money left, and may I close this. */}
      {trade.isSubmitting && !trade.isMining && (
        <p className="mt-2 text-[11px] leading-snug text-[var(--text-muted)]" role="status">
          <span className="font-semibold text-[var(--text-secondary)]">
            Waiting for your wallet.
          </span>{" "}
          Nothing has been sent yet — approve it there, or dismiss to cancel.
        </p>
      )}
      {trade.isMining && (
        <p className="mt-2 text-[11px] leading-snug text-[var(--text-muted)]" role="status">
          <span className="font-semibold text-[var(--text-secondary)]">
            Sent — waiting for Base to confirm.
          </span>{" "}
          Your wallet has been debited. This usually takes a few seconds. You can safely leave this
          screen; the result will be here when you come back.
        </p>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={onConfirm}
        aria-live="polite"
        className={`${CTRL} mt-4 w-full text-[15px] font-semibold disabled:opacity-40`}
        style={PRIMARY_STYLE}
      >
        {label}
      </button>
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
  const { unit } = useDisplayUnit();
  // Proceeds are ETH-native (a wei quote); worth is USD-native. Both go to the
  // viewer's chosen unit through the one rate.
  const proceedsStr = (signed = false) =>
    proceeds == null
      ? "—"
      : formatMoney(weiToEth(proceeds), { from: "ETH", to: unit, ethUsd, signed });
  const busy = trade.isSubmitting || trade.isMining;
  const [details, setDetails] = useState(false);

  // Escape dismisses the sell form, exactly as it dismisses the buy form.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // Receipt — same card footprint + full-width action as the form, so leaving a
  // sell never resizes the surface.
  if (trade.isSuccess) {
    return (
      <div className={CARD} style={CARD_STYLE}>
        <div className="mb-3 flex items-center gap-3 px-0.5">
          <span
            className="grid h-7 w-7 place-items-center rounded-full"
            style={{ background: "color-mix(in oklab,var(--text-muted) 18%,transparent)" }}
          >
            <span className="text-[var(--text-secondary)]">✓</span>
          </span>
          <div>
            <div className="text-[14px] font-semibold text-[var(--text)]">Left {held.side}</div>
            {proceeds != null && (
              <div className="num text-[11px] text-[var(--text-muted)]">
                Sold {fmtShares(sharesForPct(held.tokens, pct))} shares · {proceedsStr(true)}
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onDone}
          className={`${CTRL} w-full text-[15px] font-semibold`}
          style={PRIMARY_STYLE}
        >
          Done
        </button>
      </div>
    );
  }

  const shares = sharesForPct(held.tokens, pct);
  // The whole ticket is denominated in money, exactly like the buy form: you type
  // how much you want to take out, not a percentage of something invisible. The
  // field opens at the WHOLE position, so leaving entirely is still one tap —
  // typing a smaller number is how you take part of it off the table.
  const priced = worthUsd != null && worthUsd > 0;
  const amountUsd = priced ? (worthUsd! * pct) / 100 : 0;
  const setAmountUsd = (usd: number) => {
    if (!priced) return;
    const p = Math.max(0, Math.min(100, (usd / worthUsd!) * 100));
    // Round to the cent so "Max" always lands exactly on the full position.
    setPct(usd >= worthUsd! ? 100 : Math.round(p * 100) / 100);
  };
  const money = (usd: number) => unitAmount(usd, unit, ethUsd);
  const positionUnit = priced ? money(worthUsd!) : `${fmtShares(held.tokens)} shares`;
  const remainingUsd = priced ? worthUsd! - amountUsd : null;

  const confirmLabel = !ready.connected
    ? "Connect wallet"
    : !ready.onBase
      ? "Switch to Base"
      : busy
        ? "Selling…"
        : priced && amountUsd <= 0
          ? "Enter an amount"
          : priced
            ? `Sell ${money(amountUsd)}`
            : `Sell all ${held.side}`;
  const disabled = ready.connected && ready.onBase && (busy || proceeds == null || shares <= 0n);

  // The SAME form as Back — title + close, the big editable amount, the size
  // line beneath it, one summary row with Details, one full-width action.
  return (
    <div className="rounded-[16px] p-5 sm:p-[22px]" style={CARD_STYLE}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-[var(--text)]">
          Sell{" "}
          <span style={{ color: held.side === "YES" ? "var(--yes)" : "var(--no)" }}>
            {held.side}
          </span>
        </h3>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Close order"
          className="-mr-1 grid h-7 w-7 place-items-center rounded-[8px] text-[var(--text-muted)] transition-colors hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text)]"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path
              d="M2 2l10 10M12 2L2 12"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div className="mt-4">
        {priced ? (
          <BigAmount amount={amountUsd} setAmount={setAmountUsd} unit={unit} ethUsd={ethUsd} />
        ) : (
          /* No value read yet — the whole position is the only honest offer. */
          <div
            className="num pb-2 text-[30px] font-semibold leading-none text-[var(--text)]"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            {fmtShares(held.tokens)}
          </div>
        )}
        <div className="mt-1.5 flex items-baseline justify-between gap-3 text-[12px] text-[var(--text-muted)]">
          <span className="num min-w-0 truncate">Position {positionUnit}</span>
          {priced && pct < 100 && (
            <button
              type="button"
              onClick={() => setPct(100)}
              className="shrink-0 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text)]"
            >
              Sell all
            </button>
          )}
        </div>
      </div>

      <div className="mt-5 flex items-baseline justify-between gap-3 text-[12px]">
        <span className="num min-w-0 truncate text-[var(--text-secondary)]">
          {quoting || proceeds == null
            ? "Calculating…"
            : `≈ ${fmtShares(shares)} shares · ${proceedsStr()} back`}
        </span>
        <button
          type="button"
          onClick={() => setDetails((d) => !d)}
          aria-expanded={details}
          aria-controls="sell-details"
          className="shrink-0 text-[12px] font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--text)]"
        >
          Details
        </button>
      </div>

      {details && (
        <div id="sell-details" className="mt-3 space-y-1.5">
          <QuoteRow k="Estimated proceeds" v={proceeds != null ? `≈ ${proceedsStr()}` : "—"} />
          <QuoteRow k="Shares sold" v={`${fmtShares(shares)} of ${fmtShares(held.tokens)}`} />
          {remainingUsd != null && (
            <QuoteRow
              k="Position remaining"
              v={pct >= 100 ? money(0) : `≈ ${money(remainingUsd)}`}
            />
          )}
          <QuoteRow k="Network" v="Base" />
        </div>
      )}

      {trade.isError && (
        <div className="mt-2 text-[11px]" role="alert" style={{ color: "var(--loss)" }}>
          {/* Never a bare "Transaction failed" when we do not know that it
              failed — that is the sentence that makes a reader submit again.
              An error we cannot name is an error we say we cannot name. */}
          {trade.error?.message?.slice(0, 120) ??
            "We didn't get a result back. Check your wallet before trying again."}
        </div>
      )}

      {/* THE TWO ANXIOUS STATES, told apart. They shared one label — "Backing
          YES…" — which answered neither of the questions a person actually has
          at each: has my money left, and may I close this. */}
      {trade.isSubmitting && !trade.isMining && (
        <p className="mt-2 text-[11px] leading-snug text-[var(--text-muted)]" role="status">
          <span className="font-semibold text-[var(--text-secondary)]">
            Waiting for your wallet.
          </span>{" "}
          Nothing has been sent yet — approve it there, or dismiss to cancel.
        </p>
      )}
      {trade.isMining && (
        <p className="mt-2 text-[11px] leading-snug text-[var(--text-muted)]" role="status">
          <span className="font-semibold text-[var(--text-secondary)]">
            Sent — waiting for Base to confirm.
          </span>{" "}
          Your wallet has been debited. This usually takes a few seconds. You can safely leave this
          screen; the result will be here when you come back.
        </p>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={onConfirm}
        aria-live="polite"
        className={`${CTRL} mt-4 w-full text-[15px] font-semibold disabled:opacity-40`}
        style={PRIMARY_STYLE}
      >
        {confirmLabel}
      </button>
    </div>
  );
}
