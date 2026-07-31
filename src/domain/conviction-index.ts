/**
 * Conviction Index — one number, three visible parts.
 *
 * A market is only ever three things: people who express belief, money that
 * commits to it, and a price that says whether the market agrees. The index is
 * the transparent blend of exactly those three, with no learning, no hidden
 * weights and no normalization a user can't redo on paper:
 *
 *     Index = 0.40 × Believer share
 *           + 0.40 × Capital share
 *           + 0.20 × Share price
 *
 * Each part is 0–100. Believer/capital share are this side's slice of the whole
 * market; price is the side's per-share price (0–1 ETH) read as a percentage.
 *
 * The trend is the same number over time. Nothing happens between trades, so it
 * is a STEP series: the value holds until an event moves it, and every step
 * carries the reason it moved.
 *
 * ZERO IO, pure, fully testable.
 */
import type { TapeTrade } from "./conviction-series";
import type { FlowWindow } from "./market-flow";
import { FLOW_WINDOW_MS } from "./market-flow";

export const INDEX_WEIGHTS = { believers: 0.4, capital: 0.4, price: 0.2 } as const;

/** Trades inside one bucket become a single readable jump. */
export const INDEX_BUCKET_MS = 15 * 60_000;

export interface IndexStep {
  id: string;
  /** Epoch ms of the jump. */
  t: number;
  /** Score before the jump (equals the previous step's index). */
  from: number;
  /** Score after the jump. */
  index: number;
  believerScore: number;
  capitalScore: number;
  priceScore: number;
  /** What moved inside this beat. */
  newBelievers: number;
  leavers: number;
  ethIn: number;
  ethOut: number;
  /** Price change across the beat, in %. Null when the tape carried no price. */
  pricePct: number | null;
  emoji: string;
  /** "Three believers joined" — money stays in ETH for the caller to format. */
  text: string;
}

const clamp100 = (n: number): number => (n < 0 ? 0 : n > 100 ? 100 : n);
const share = (part: number, total: number): number =>
  total > 0 ? clamp100((part / total) * 100) : 50;

/** The blend, exposed so a caller can show the arithmetic. */
export function indexOf(believerScore: number, capitalScore: number, priceScore: number): number {
  return (
    INDEX_WEIGHTS.believers * believerScore +
    INDEX_WEIGHTS.capital * capitalScore +
    INDEX_WEIGHTS.price * priceScore
  );
}

interface Ledger {
  believers: Record<"YES" | "NO", Set<string>>;
  capital: Record<"YES" | "NO", number>;
  price: Record<"YES" | "NO", number | null>;
}

function scoresFor(l: Ledger, side: "YES" | "NO") {
  const other = side === "YES" ? "NO" : "YES";
  const believerScore = share(
    l.believers[side].size,
    l.believers[side].size + l.believers[other].size,
  );
  const capitalScore = share(l.capital[side], l.capital[side] + l.capital[other]);
  const p = l.price[side];
  // Price is read as the market's own confirmation: this side's share of the two
  // prices, i.e. the implied probability. Scale-free, so it works in any units.
  const q = l.price[other];
  const priceScore =
    p != null && Number.isFinite(p) && q != null && Number.isFinite(q) && p + q > 0
      ? clamp100((p / (p + q)) * 100)
      : 50;
  return {
    believerScore,
    capitalScore,
    priceScore,
    index: indexOf(believerScore, capitalScore, priceScore),
  };
}

function reason(
  newBelievers: number,
  leavers: number,
  ethIn: number,
  ethOut: number,
  pricePct: number | null,
): { emoji: string; text: string } {
  if (newBelievers > 0)
    return {
      emoji: "👥",
      text: `${newBelievers} believer${newBelievers === 1 ? "" : "s"} joined`,
    };
  if (ethIn > 0) return { emoji: "💰", text: "Capital added" };
  if (ethOut > 0) return { emoji: "↩", text: "Capital left" };
  if (leavers > 0) return { emoji: "↩", text: "Position reduced" };
  if (pricePct != null && pricePct !== 0)
    return { emoji: "📈", text: pricePct > 0 ? "Price confirmed" : "Price faded" };
  return { emoji: "•", text: "Market moved" };
}

/**
 * The step series for one side, inside one window.
 *
 * `trades` must be the market's FULL known history (both sides, any order) so
 * the score the window opens on is the real inherited one.
 */
export function convictionIndexSeries(
  trades: TapeTrade[],
  side: "YES" | "NO",
  win: FlowWindow,
  nowMs: number,
): { opening: IndexStep | null; steps: IndexStep[] } {
  const sorted = trades.filter((t) => Number.isFinite(t.t)).sort((a, b) => a.t - b.t);
  if (sorted.length === 0) return { opening: null, steps: [] };

  const since = win === "all" ? -Infinity : nowMs - FLOW_WINDOW_MS[win];
  const ledger: Ledger = {
    believers: { YES: new Set(), NO: new Set() },
    capital: { YES: 0, NO: 0 },
    price: { YES: null, NO: null },
  };

  const apply = (t: TapeTrade) => {
    const eth = Number.isFinite(t.eth) ? Math.max(0, t.eth) : 0;
    if (t.action === "BUY") {
      ledger.capital[t.side] += eth;
      ledger.believers[t.side].add(t.w);
    } else {
      ledger.capital[t.side] = Math.max(0, ledger.capital[t.side] - eth);
    }
    if (t.price != null && Number.isFinite(t.price) && t.price > 0) ledger.price[t.side] = t.price;
  };

  // Everything before the window collapses into the opening score.
  const before = sorted.filter((t) => t.t < since);
  for (const t of before) apply(t);
  const openScores = scoresFor(ledger, side);
  const inWin = sorted.filter((t) => t.t >= since);
  const openingT = since === -Infinity ? sorted[0].t : Math.min(since, sorted[0].t);
  const opening: IndexStep = {
    id: "open",
    t: openingT,
    from: openScores.index,
    ...openScores,
    newBelievers: 0,
    leavers: 0,
    ethIn: 0,
    ethOut: 0,
    pricePct: null,
    emoji: "•",
    text: "Window opened",
  };

  // Group into beats so the line reads as a handful of understandable jumps.
  const beats = new Map<number, TapeTrade[]>();
  for (const t of inWin) {
    const key = Math.floor(t.t / INDEX_BUCKET_MS) * INDEX_BUCKET_MS;
    const arr = beats.get(key);
    if (arr) arr.push(t);
    else beats.set(key, [t]);
  }

  const steps: IndexStep[] = [];
  let prev = openScores.index;
  for (const [key, group] of [...beats.entries()].sort((a, b) => a[0] - b[0])) {
    const priceBefore = ledger.price[side];
    let newBelievers = 0;
    let leavers = 0;
    let ethIn = 0;
    let ethOut = 0;
    for (const t of group) {
      const eth = Number.isFinite(t.eth) ? Math.max(0, t.eth) : 0;
      if (t.side === side) {
        if (t.action === "BUY") {
          if (!ledger.believers[side].has(t.w)) newBelievers += 1;
          ethIn += eth;
        } else {
          leavers += 1;
          ethOut += eth;
        }
      }
      apply(t);
    }
    const priceAfter = ledger.price[side];
    const pricePct =
      priceBefore != null && priceBefore > 0 && priceAfter != null
        ? ((priceAfter - priceBefore) / priceBefore) * 100
        : null;
    const s = scoresFor(ledger, side);
    const r = reason(newBelievers, leavers, ethIn, ethOut, pricePct);
    steps.push({
      id: `step-${side}-${key}`,
      t: group[group.length - 1].t,
      from: prev,
      ...s,
      newBelievers,
      leavers,
      ethIn,
      ethOut,
      pricePct,
      ...r,
    });
    prev = s.index;
  }

  return { opening, steps };
}

/** Plain-language read of the window's move, for the line under the number. */
export function indexTrendCaption(opening: IndexStep | null, steps: IndexStep[]): string | null {
  if (!opening) return null;
  const last = steps[steps.length - 1];
  if (!last) return "Nothing moved in this window — conviction is unchanged.";
  const delta = last.index - opening.index;
  if (Math.abs(delta) < 0.5) return "Conviction held steady through this window.";
  const driver =
    steps.reduce(
      (best, s) => (Math.abs(s.index - s.from) > Math.abs(best.index - best.from) ? s : best),
      steps[0],
    ) ?? last;
  return `Conviction ${delta > 0 ? "rose" : "fell"} ${Math.abs(delta).toFixed(1)} points — biggest move: ${driver.text.toLowerCase()}.`;
}
