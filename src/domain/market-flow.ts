/**
 * Market flow — conviction CHANGE inside one time window.
 *
 * The deck's story is "who believes this, how much money stands behind them, is
 * that growing?". Totals live on the side cards; this module owns the *deltas*
 * for exactly one active window (1H / 1D / 1W / 1M / All) so the Pulse headline
 * and the side cards can never quote two different periods at once.
 *
 * ZERO IO, pure, fully testable. It can only ever say what the trades prove.
 */

export type FlowWindow = "1h" | "24h" | "7d" | "30d" | "all";

export const FLOW_WINDOW_MS: Record<Exclude<FlowWindow, "all">, number> = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 604_800_000,
  "30d": 2_592_000_000,
};

/** Human period words used in copy — "in the last hour", "today", … */
export const FLOW_WINDOW_PHRASE: Record<FlowWindow, string> = {
  "1h": "this hour",
  "24h": "today",
  "7d": "this week",
  "30d": "this month",
  all: "so far",
};

/** Short suffix used on the side cards ("+3 believers · 1D"). */
export const FLOW_WINDOW_SHORT: Record<FlowWindow, string> = {
  "1h": "1H",
  "24h": "1D",
  "7d": "1W",
  "30d": "1M",
  all: "all",
};

export interface FlowTrade {
  wallet: string;
  side: "YES" | "NO";
  action: "BUY" | "SELL";
  /** Value moved, in USD. */
  usd: number;
  /** Epoch ms of the canonical event time. */
  at: number;
}

export interface SideFlow {
  /** Wallets whose FIRST buy on this side happened inside the window. */
  newBelievers: number;
  /** Net dollars added to this side inside the window (buys − sells). */
  netUsd: number;
  /** Number of distinct wallets that bought inside the window. */
  buyers: number;
  /** The single largest buy inside the window, in USD. */
  largestBuyUsd: number;
}

export interface WindowFlow {
  yes: SideFlow;
  no: SideFlow;
}

const emptySide = (): SideFlow => ({ newBelievers: 0, netUsd: 0, buyers: 0, largestBuyUsd: 0 });

/**
 * Flows for one window. `trades` must be the market's full known trade history
 * (ordered any way) so "new believer" means genuinely first-time, not just
 * first-seen inside the fetched slice.
 */
export function flowForWindow(trades: FlowTrade[], win: FlowWindow, nowMs: number): WindowFlow {
  const since = win === "all" ? -Infinity : nowMs - FLOW_WINDOW_MS[win];
  const out: WindowFlow = { yes: emptySide(), no: emptySide() };

  // First buy per wallet+side across ALL history.
  const firstBuy = new Map<string, number>();
  for (const t of trades) {
    if (t.action !== "BUY") continue;
    const k = `${t.wallet.toLowerCase()}|${t.side}`;
    const prev = firstBuy.get(k);
    if (prev == null || t.at < prev) firstBuy.set(k, t.at);
  }

  const buyers = { YES: new Set<string>(), NO: new Set<string>() };
  for (const t of trades) {
    if (t.at < since) continue;
    const s = t.side === "YES" ? out.yes : out.no;
    const usd = Number.isFinite(t.usd) ? Math.max(0, t.usd) : 0;
    if (t.action === "BUY") {
      s.netUsd += usd;
      s.largestBuyUsd = Math.max(s.largestBuyUsd, usd);
      buyers[t.side].add(t.wallet.toLowerCase());
    } else {
      s.netUsd -= usd;
    }
  }
  out.yes.buyers = buyers.YES.size;
  out.no.buyers = buyers.NO.size;

  for (const [k, at] of firstBuy) {
    if (at < since) continue;
    const side = k.endsWith("|YES") ? out.yes : out.no;
    side.newBelievers += 1;
  }
  return out;
}
