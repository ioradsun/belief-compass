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

// ---------------------------------------------------------------------------
// The Pulse headline — one story, one window, never a total.
// ---------------------------------------------------------------------------

export type PulseKind =
  | "growing"
  | "whale"
  | "grassroots"
  | "divided"
  | "cooling"
  | "quiet";

export interface PulseStory {
  kind: PulseKind;
  /** "Growing conviction on YES" */
  headline: string;
  /** The side the story is about, when it has one. */
  side: "YES" | "NO" | null;
  /** One short supporting sentence, or null when the metrics say it all. */
  note: string | null;
  /** Ordered evidence lines: believers → money → price. Already formatted. */
  metrics: { key: "believers" | "money" | "price"; text: string }[];
}

/** ≥ this much money from ≤1 buyer inside the window reads as whale activity. */
export const WHALE_USD = 2_000;
/** Grassroots: this many new believers, each of them small. */
export const GRASSROOTS_BELIEVERS = 5;
export const GRASSROOTS_AVG_USD = 50;

const money = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 10_000 ? `$${Math.round(a / 1000)}k` : a >= 1000 ? `$${(a / 1000).toFixed(1)}k` : `$${Math.round(a)}`;
  return n < 0 ? `−${s}` : s;
};

const pct = (n: number) =>
  `${n < 0 ? "−" : "+"}${Math.abs(n).toFixed(Math.abs(n) < 10 ? 1 : 0)}%`;

/**
 * Turns one window's flow (plus that same window's price move) into the
 * newspaper headline above the YES/NO cards. Priority is believer growth →
 * money growth → price. Never invents urgency: with nothing to report it says so.
 */
export function composePulseStory(
  flow: WindowFlow,
  price: { yes: number | null; no: number | null },
  win: FlowWindow,
): PulseStory {
  const when = FLOW_WINDOW_PHRASE[win];
  const y = flow.yes;
  const n = flow.no;
  const totalNew = y.newBelievers + n.newBelievers;
  const totalMoney = y.netUsd + n.netUsd;

  const quiet: PulseStory = {
    kind: "quiet",
    headline: "Quiet market",
    side: null,
    note: `No meaningful conviction changes ${when}.`,
    metrics: [],
  };
  if (totalNew === 0 && Math.abs(totalMoney) < 1) return quiet;

  // Which side owns the story: believers first, money as the tie-break.
  const side: "YES" | "NO" =
    y.newBelievers !== n.newBelievers
      ? y.newBelievers > n.newBelievers
        ? "YES"
        : "NO"
      : y.netUsd >= n.netUsd
        ? "YES"
        : "NO";
  const lead = side === "YES" ? y : n;
  const other = side === "YES" ? n : y;
  const chg = side === "YES" ? price.yes : price.no;

  const metrics: PulseStory["metrics"] = [];
  if (lead.newBelievers > 0)
    metrics.push({
      key: "believers",
      text: `+${lead.newBelievers} believer${lead.newBelievers === 1 ? "" : "s"}`,
    });
  if (Math.abs(lead.netUsd) >= 1)
    metrics.push({
      key: "money",
      text: `${lead.netUsd < 0 ? "" : "+"}${money(lead.netUsd)} backed`,
    });
  if (chg != null && Number.isFinite(chg))
    metrics.push({ key: "price", text: `Price ${pct(chg)}` });

  // Whale: real money, almost nobody behind it.
  if (lead.netUsd >= WHALE_USD && lead.buyers <= 1) {
    return {
      kind: "whale",
      headline: "Whale activity",
      side,
      note: `One investor added ${money(lead.netUsd)} to ${side} while participation stayed flat.`,
      metrics,
    };
  }

  // Grassroots: many people, small tickets.
  if (
    lead.newBelievers >= GRASSROOTS_BELIEVERS &&
    lead.netUsd / Math.max(1, lead.newBelievers) < GRASSROOTS_AVG_USD
  ) {
    return {
      kind: "grassroots",
      headline: "Grassroots movement",
      side,
      note: `${lead.newBelievers} new believers joined ${side} with small positions.`,
      metrics,
    };
  }

  // Both sides gaining people at the same rate.
  if (totalNew >= 2 && Math.abs(y.newBelievers - n.newBelievers) <= 1) {
    return {
      kind: "divided",
      headline: "People divided",
      side: null,
      note: "Believer growth remains balanced across both sides.",
      metrics,
    };
  }

  // Money leaving faster than people arrive.
  if (lead.newBelievers === 0 && lead.netUsd < 0) {
    return {
      kind: "cooling",
      headline: `Conviction slipping on ${side}`,
      side,
      note: `Capital left ${side} ${when} with no new believers.`,
      metrics,
    };
  }

  return {
    kind: "growing",
    headline: `Growing conviction on ${side}`,
    side,
    note:
      other.newBelievers > 0 && lead.newBelievers > 0 && Math.abs(lead.netUsd) >= 1
        ? null
        : null,
    metrics,
  };
}

/** Re-denominate a flow's money fields (ETH → USD) with a live rate. */
export function scaleFlow(flow: WindowFlow, rate: number): WindowFlow {
  const s = (f: SideFlow): SideFlow => ({
    ...f,
    netUsd: f.netUsd * rate,
    largestBuyUsd: f.largestBuyUsd * rate,
  });
  return { yes: s(flow.yes), no: s(flow.no) };
}
