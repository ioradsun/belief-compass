/**
 * Order ticket — the shared decision controls.
 *
 * The single source of truth for "YES or NO?" and "how much?": the side buttons,
 * the dollar amount field (with its ETH conversion), the wallet balance / Max /
 * minimum line, the quote k/v row, and the primary action button with its wallet
 * and transaction states. Both surfaces compose these atoms:
 *   • the market page's decision Dock (buy a side, reveal the House), and
 *   • the Create Market screen (seed a new market).
 * Neither screen re-implements an amount input, a side control, or a balance read.
 *
 * These are presentational atoms plus one balance reader — no trade or create
 * logic lives here; each screen owns its own submission.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useAccount, useBalance } from "wagmi";
import { CHAIN_ID } from "@/chain/decoder";
import { fmtUsd } from "@/domain/order";

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
