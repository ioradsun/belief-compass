/**
 * Order math + Pulse mapping (pure, no wallet/chain imports).
 *
 * ZERO IO. The safe, testable core behind the decision dock: slippage floors,
 * USD⇄ETH⇄wei conversion, average-price, and the Pulse read. The chain hooks
 * (src/lib/chain-trade.ts) and the deck UI consume these — no price math ever
 * happens in a component.
 */

import { convertMoney, weiToEth } from "@/domain/money";

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

/**
 * Shares to sell for a percentage of a holding (pct clamped 0..100). Resolved in
 * basis points so a money-denominated sell (e.g. "$3.40 of a $9.10 position")
 * keeps its precision instead of snapping to whole percents.
 */
export function sharesForPct(tokens: bigint, pct: number): bigint {
  if (tokens <= 0n) return 0n;
  const p = pct <= 0 ? 0 : pct >= 100 ? 100 : pct;
  if (p === 100) return tokens;
  const bps = BigInt(Math.floor(p * 100));
  return (tokens * bps) / 10_000n;
}

/**
 * Wei in USD, or null when there is no rate to cross with.
 *
 * Was `weiToEth(wei) * ethUsd`, which returned 0 for every amount when the rate
 * was missing — the confident zero this codebase has now removed from the server
 * (lib/eth-usd.server) and the display surfaces (domain/money#convertMoney).
 */
export function weiToUsd(wei: bigint, ethUsd: number): number | null {
  return convertMoney(weiToEth(wei), "ETH", "USD", ethUsd);
}

/**
 * Average execution price in USD per share, from the ETH spent and shares out.
 *
 * Null rather than 0 when it cannot be computed: "$0.00 avg" on a real trade is
 * a claim about the price, and a missing rate is not one.
 */
export function avgPriceUsd(ethWei: bigint, sharesWei: bigint, ethUsd: number): number | null {
  if (sharesWei <= 0n) return null;
  const shares = weiToEth(sharesWei);
  if (!(shares > 0)) return null;
  const usd = weiToUsd(ethWei, ethUsd);
  return usd == null ? null : usd / shares;
}

export const fmtUsd = (n: number): string =>
  n >= 1000 ? `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}` : `$${n.toFixed(2)}`;

export const fmtShares = (sharesWei: bigint): string => {
  const s = weiToEth(sharesWei);
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
