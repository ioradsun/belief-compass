/**
 * Order math + Pulse mapping (pure, no wallet/chain imports).
 *
 * ZERO IO. The safe, testable core behind the decision dock: slippage floors,
 * USD⇄ETH⇄wei conversion, average-price, and the Pulse read. The chain hooks
 * (src/lib/chain-trade.ts) and the deck UI consume these — no price math ever
 * happens in a component.
 */

/** Default slippage tolerance for minTokensOut / minEthOut (basis points). */
export const DEFAULT_SLIPPAGE_BPS = 200n; // 2%
const WEI_PER_GWEI = 1_000_000_000n;

/** Floor an on-chain quote by a slippage tolerance → the min-out to send. */
export function minOut(quoted: bigint, bps: bigint = DEFAULT_SLIPPAGE_BPS): bigint {
  if (quoted <= 0n) return 0n;
  const clamped = bps < 0n ? 0n : bps > 10_000n ? 10_000n : bps;
  return (quoted * (10_000n - clamped)) / 10_000n;
}

/**
 * USD → wei via the app's ETH/USD calibration. Computed through gwei so the
 * intermediate stays inside Number's safe-integer range (a direct ×1e18 would
 * lose precision above ~0.009 ETH).
 */
export function usdToWei(usd: number, ethUsd: number): bigint {
  if (!(usd > 0) || !(ethUsd > 0)) return 0n;
  const gwei = Math.round((usd / ethUsd) * 1e9);
  return BigInt(gwei) * WEI_PER_GWEI;
}

export function weiToEth(wei: bigint): number {
  return Number(wei) / 1e18;
}

export function weiToUsd(wei: bigint, ethUsd: number): number {
  return weiToEth(wei) * ethUsd;
}

/** Average execution price in USD per share, from the ETH spent and shares out. */
export function avgPriceUsd(ethWei: bigint, sharesWei: bigint, ethUsd: number): number {
  if (sharesWei <= 0n) return 0;
  const shares = Number(sharesWei) / 1e18;
  if (!(shares > 0)) return 0;
  return weiToUsd(ethWei, ethUsd) / shares;
}

export const fmtUsd = (n: number): string =>
  n >= 1000 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : `$${n.toFixed(2)}`;

export const fmtShares = (sharesWei: bigint): string => {
  const s = Number(sharesWei) / 1e18;
  return s >= 1000 ? s.toLocaleString("en-US", { maximumFractionDigits: 0 }) : s.toFixed(2);
};

// ── Pulse (from the global opportunity classification) ───────────────────────
export type PulseTone = "hot" | "warm" | "neutral";

export interface Pulse {
  label: string;
  tone: PulseTone;
  why: string;
}

const PULSE: Record<string, { label: string; tone: PulseTone; fallback: string }> = {
  hot: { label: "Accelerating", tone: "hot", fallback: "Activity is picking up fast." },
  early: { label: "Early", tone: "warm", fallback: "Small but growing." },
  hidden: { label: "Quiet strength", tone: "warm", fallback: "More going on than the size shows." },
  contested: { label: "Divided", tone: "warm", fallback: "Both sides are still buying." },
  conviction: { label: "Held", tone: "neutral", fallback: "Holders are staying put." },
  new: { label: "New", tone: "warm", fallback: "Just opened." },
};

/** Map the market's opportunity classification + reason into a Pulse read. */
export function pulseFor(opportunityType: string | null, reason: string | null): Pulse {
  const p = opportunityType ? PULSE[opportunityType] : undefined;
  if (!p) return { label: "Steady", tone: "neutral", why: reason?.trim() || "Trading quietly." };
  return { label: p.label, tone: p.tone, why: reason?.trim() || p.fallback };
}

// ── Order phase (a small explicit machine; the deck holds one of these) ──────
export type OrderSide = "YES" | "NO";
export type OrderPhase =
  | "neutral"
  | "selected" // side chosen, quote loading
  | "quoted" // quote ready, awaiting explicit confirm
  | "quote_error"
  | "pending" // tx submitted
  | "success" // receipt
  | "error";

/** A gesture/button/keyboard only ever SELECTS — it never buys. */
export function selectSide(current: OrderSide | null, next: OrderSide): OrderSide | null {
  return current === next ? null : next; // tapping the selected side deselects
}
