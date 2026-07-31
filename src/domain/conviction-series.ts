/**
 * Conviction series — how belief FORMED, not what the price is.
 *
 * A prediction market normally plots price. Price is the last thing to happen:
 * someone becomes convinced, they commit capital, and only then does the market
 * re-rate. This module rebuilds that causal chain from the canonical trade tape
 * so one chart can answer the only question an investor actually has:
 *
 *     Did people lead, did money lead, or did price lead?
 *
 * Three cumulative curves per side — believers (👥), capital backed (💰), price
 * (📈) — are normalized to their % change since the start of the selected window
 * so three different units share one axis and leadership is visible at a glance.
 *
 * ZERO IO, pure, fully testable. It can only ever say what the trades prove.
 */
import type { FlowWindow } from "./market-flow";
import { FLOW_WINDOW_MS } from "./market-flow";

/** A single canonical trade, compacted for the wire. Money is ETH, not USD. */
export interface TapeTrade {
  /** Stable per-wallet key — enough to count distinct believers, nothing more. */
  w: string;
  side: "YES" | "NO";
  action: "BUY" | "SELL";
  /** Value moved, in ETH. */
  eth: number;
  /** Per-share price at the trade, in ETH. Null when the tape didn't carry one. */
  price: number | null;
  /** Epoch ms of the canonical event time. */
  t: number;
}

export interface SeriesPoint {
  t: number;
  /** Cumulative distinct believers on this side at t. */
  believers: number;
  /** Cumulative capital backing this side at t, in ETH (buys − sells, floored at 0). */
  capital: number;
  /** Last traded price on this side at t, in ETH. Null before the first trade. */
  price: number | null;
  /** % change vs the window's first point — the plotted values. */
  believersPct: number;
  capitalPct: number;
  pricePct: number | null;
}

export type TimelineEventKind =
  | "believers"
  | "capital"
  | "whale"
  | "price"
  | "milestone"
  | "exit";

export interface TimelineEvent {
  id: string;
  kind: TimelineEventKind;
  t: number;
  emoji: string;
  /** "12 believers joined YES" — the money figure stays in ETH for the caller. */
  text: string;
  /** ETH moved in this event, when it is about money. */
  eth?: number;
}

/** A whale is a single buy this many times the window's median buy. */
export const WHALE_MULTIPLE = 6;
/** Bucket width for grouping the rail into readable beats. */
export const RAIL_BUCKET_MS = 15 * 60_000;
/** Believer milestones worth calling out. */
export const BELIEVER_MILESTONES = [10, 25, 50, 100, 250, 500, 1000];

const pctChange = (from: number, to: number): number => {
  if (from > 0) return ((to - from) / from) * 100;
  // Growth from nothing has no finite %; treat any arrival as +100% so the line
  // still reads as "this went from zero to something" without inventing a scale.
  return to > 0 ? 100 : 0;
};

/**
 * Cumulative + normalized series for one side.
 *
 * `trades` must be the market's full known history (any order) so cumulative
 * totals at the window's start are real, not just "first seen in the slice".
 */
export function convictionSeries(
  trades: TapeTrade[],
  side: "YES" | "NO",
  win: FlowWindow,
  nowMs: number,
  maxPoints = 120,
): SeriesPoint[] {
  const mine = trades
    .filter((t) => t.side === side && Number.isFinite(t.t))
    .sort((a, b) => a.t - b.t);
  if (mine.length === 0) return [];

  const since = win === "all" ? -Infinity : nowMs - FLOW_WINDOW_MS[win];

  const seen = new Set<string>();
  let believers = 0;
  let capital = 0;
  let price: number | null = null;
  const raw: Omit<SeriesPoint, "believersPct" | "capitalPct" | "pricePct">[] = [];

  for (const t of mine) {
    const eth = Number.isFinite(t.eth) ? Math.max(0, t.eth) : 0;
    if (t.action === "BUY") {
      capital += eth;
      if (!seen.has(t.w)) {
        seen.add(t.w);
        believers += 1;
      }
    } else {
      capital = Math.max(0, capital - eth);
    }
    if (t.price != null && Number.isFinite(t.price) && t.price > 0) price = t.price;
    raw.push({ t: t.t, believers, capital, price });
  }

  // Everything before the window collapses into ONE opening point: the state the
  // window inherits. Normalizing against it is what makes "who moved first" true.
  const inWindow = raw.filter((p) => p.t >= since);
  const priorIdx = raw.length - inWindow.length - 1;
  const opening =
    priorIdx >= 0
      ? { ...raw[priorIdx], t: since === -Infinity ? raw[0].t : since }
      : { t: since === -Infinity ? raw[0].t : Math.min(since, raw[0].t), believers: 0, capital: 0, price: inWindow[0]?.price ?? null };

  const pts = [opening, ...inWindow];
  const base = pts[0];
  const normalized: SeriesPoint[] = pts.map((p) => ({
    ...p,
    believersPct: pctChange(base.believers, p.believers),
    capitalPct: pctChange(base.capital, p.capital),
    pricePct:
      base.price != null && base.price > 0 && p.price != null
        ? ((p.price - base.price) / base.price) * 100
        : p.price != null && base.price == null
          ? 0
          : null,
  }));

  return downsample(normalized, maxPoints);
}

/** Keeps the first, the last, and an even spread between — shape is preserved. */
function downsample(pts: SeriesPoint[], max: number): SeriesPoint[] {
  if (pts.length <= max) return pts;
  const step = (pts.length - 1) / (max - 1);
  const out: SeriesPoint[] = [];
  for (let i = 0; i < max; i++) out.push(pts[Math.round(i * step)]);
  return out;
}

/**
 * The event rail — the chart says WHAT happened, the rail says WHY. Trades are
 * grouped into beats so the rail reads like a story, not a ledger, and a single
 * outsized buy is always called out on its own.
 */
export function timelineEvents(
  trades: TapeTrade[],
  side: "YES" | "NO",
  win: FlowWindow,
  nowMs: number,
  limit = 12,
): TimelineEvent[] {
  const since = win === "all" ? -Infinity : nowMs - FLOW_WINDOW_MS[win];
  const all = trades
    .filter((t) => t.side === side && Number.isFinite(t.t))
    .sort((a, b) => a.t - b.t);

  // Believer count entering the window, so milestones are truthful.
  const seenBefore = new Set<string>();
  for (const t of all) {
    if (t.t >= since) break;
    if (t.action === "BUY") seenBefore.add(t.w);
  }
  let believers = seenBefore.size;

  const inWin = all.filter((t) => t.t >= since);
  const buys = inWin.filter((t) => t.action === "BUY" && t.eth > 0).map((t) => t.eth);
  const median = buys.length ? [...buys].sort((a, b) => a - b)[Math.floor(buys.length / 2)] : 0;
  const whaleFloor = median > 0 ? median * WHALE_MULTIPLE : Infinity;

  const out: TimelineEvent[] = [];
  type Bucket = { t: number; newBelievers: number; eth: number; sellEth: number };
  const buckets = new Map<number, Bucket>();
  const seen = new Set(seenBefore);

  for (const t of inWin) {
    const key = Math.floor(t.t / RAIL_BUCKET_MS) * RAIL_BUCKET_MS;
    const b = buckets.get(key) ?? { t: key, newBelievers: 0, eth: 0, sellEth: 0 };
    if (t.action === "BUY") {
      const isNew = !seen.has(t.w);
      if (isNew) {
        seen.add(t.w);
        believers += 1;
        b.newBelievers += 1;
        for (const m of BELIEVER_MILESTONES) {
          if (believers === m) {
            out.push({
              id: `mile-${side}-${m}`,
              kind: "milestone",
              t: t.t,
              emoji: "🏆",
              text: `${side} reached ${m} believers`,
            });
          }
        }
      }
      // An outsized single buy is its own headline — never buried in a bucket.
      if (t.eth >= whaleFloor) {
        out.push({
          id: `whale-${side}-${t.t}-${t.w}`,
          kind: "whale",
          t: t.t,
          emoji: "🐋",
          eth: t.eth,
          text: `One investor backed ${side}`,
        });
      } else {
        b.eth += t.eth;
      }
    } else {
      b.sellEth += t.eth;
    }
    buckets.set(key, b);
  }

  for (const b of buckets.values()) {
    if (b.newBelievers > 0) {
      out.push({
        id: `bel-${side}-${b.t}`,
        kind: "believers",
        t: b.t,
        emoji: "👥",
        text: `${b.newBelievers} believer${b.newBelievers === 1 ? "" : "s"} joined ${side}`,
      });
    }
    if (b.eth > 0) {
      out.push({
        id: `cap-${side}-${b.t}`,
        kind: "capital",
        t: b.t,
        emoji: "💰",
        eth: b.eth,
        text: `backed ${side}`,
      });
    }
    if (b.sellEth > 0) {
      out.push({
        id: `exit-${side}-${b.t}`,
        kind: "exit",
        t: b.t,
        emoji: "↩",
        eth: b.sellEth,
        text: `left ${side}`,
      });
    }
  }

  return out.sort((a, b) => b.t - a.t).slice(0, limit);
}

/**
 * Which curve led? Pure read of the normalized end-state — used for the caption
 * under the chart. It never claims leadership without a real gap.
 */
export function leadStory(pts: SeriesPoint[]): string | null {
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1];
  const b = last.believersPct;
  const c = last.capitalPct;
  const p = last.pricePct ?? 0;
  if (b <= 0 && c <= 0 && p <= 0) return null;
  if (c > b * 2 && c > 20 && b < 20) return "Money moved without new people — a large position led.";
  if (b > c * 1.5 && b > 20) return "People arrived first; capital is still catching up.";
  if (p > b && p > c && p > 10) return "Price moved ahead of the belief behind it.";
  if (b > 0 && c > 0 && p >= 0) return "People, money and price are moving together.";
  return null;
}
