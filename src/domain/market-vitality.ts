/**
 * MARKET VITALITY — the whole market, with the sides removed.
 *
 * The center panel must answer "is this question attracting conviction?" without
 * ever answering "which side is winning?". So everything here is deliberately
 * side-blind: it replays the canonical trade tape into two market-level numbers
 *
 *   • total believers  — unique wallets currently holding a DIRECTIONAL position
 *                        (a wallet on both sides is "mixed" and is not counted;
 *                         a wallet with nothing left is inactive)
 *   • total capital    — the sum of what is still committed on both sides
 *
 * and the event-driven STEP history of each. Nothing is interpolated, nothing is
 * smoothed, and no per-side quantity is ever returned.
 *
 * ZERO IO, pure, fully testable.
 */
import type { TapeTrade } from "./conviction-series";

export interface VitalityPoint {
  t: number;
  v: number;
}

export type RangeKind = "since-creation" | "24h" | "7d";

export interface VitalityRange {
  kind: RangeKind;
  /** Epoch ms the window opens on. */
  sinceMs: number;
  /** One quiet shared label, e.g. "Past 7 days". */
  label: string;
}

export interface MarketVitality {
  range: VitalityRange;
  /** Unique wallets currently holding a directional belief (both sides combined). */
  believers: number;
  /** Capital still committed across both sides, in ETH. */
  capitalEth: number;
  believersSeries: VitalityPoint[];
  capitalSeries: VitalityPoint[];
  /** Change across the window (now − value when the window opened). */
  believersDelta: number;
  capitalDeltaEth: number;
  /** How many step changes happened inside the window (drives cold-start copy). */
  believerEvents: number;
  capitalEvents: number;
  /** When the very first believer arrived — for the one-event copy. */
  firstBelieverAt: number | null;
  /** Epoch ms of the most recent tape event, or null on an empty market. */
  lastEventAt: number | null;
  /** New directional wallets and net ETH inside the last 24 hours. */
  entrants24h: number;
  netEth24h: number;
}

const DAY = 86_400_000;

/** Adaptive range: young markets show their whole life, older ones a fixed window. */
export function vitalityRange(firstEventAt: number | null, nowMs: number): VitalityRange {
  const ageMs = firstEventAt == null ? 0 : nowMs - firstEventAt;
  if (firstEventAt == null || ageMs < DAY)
    return { kind: "since-creation", sinceMs: firstEventAt ?? nowMs, label: "Since creation" };
  if (ageMs <= 7 * DAY) return { kind: "24h", sinceMs: nowMs - DAY, label: "Past 24 hours" };
  return { kind: "7d", sinceMs: nowMs - 7 * DAY, label: "Past 7 days" };
}

type Book = Record<"YES" | "NO", number>;

function directional(b: Book): boolean {
  const yes = b.YES > 1e-12;
  const no = b.NO > 1e-12;
  return (yes && !no) || (no && !yes);
}

/** Replay the tape into side-blind totals plus their step histories. */
export function marketVitality(tape: TapeTrade[], nowMs: number): MarketVitality {
  const sorted = tape.filter((t) => Number.isFinite(t.t)).sort((a, b) => a.t - b.t);
  const first = sorted.length ? sorted[0].t : null;
  const range = vitalityRange(first, nowMs);

  const books = new Map<string, Book>();
  let believers = 0;
  let capital = 0;
  const bHist: VitalityPoint[] = [];
  const cHist: VitalityPoint[] = [];
  let firstBelieverAt: number | null = null;
  let entrants24h = 0;
  let netEth24h = 0;
  const since24 = nowMs - DAY;

  for (const t of sorted) {
    const eth = Number.isFinite(t.eth) ? Math.max(0, t.eth) : 0;
    const book = books.get(t.w) ?? { YES: 0, NO: 0 };
    const wasDirectional = directional(book);
    const before = book[t.side];
    book[t.side] = t.action === "BUY" ? before + eth : Math.max(0, before - eth);
    books.set(t.w, book);

    capital = Math.max(0, capital + (book[t.side] - before));
    const isDirectional = directional(book);
    if (isDirectional !== wasDirectional) {
      believers += isDirectional ? 1 : -1;
      if (isDirectional && firstBelieverAt == null) firstBelieverAt = t.t;
      if (isDirectional && t.t >= since24) entrants24h += 1;
      bHist.push({ t: t.t, v: believers });
    }
    if (t.t >= since24) netEth24h += book[t.side] - before;
    cHist.push({ t: t.t, v: capital });
  }

  const clip = (hist: VitalityPoint[]): { series: VitalityPoint[]; open: number } => {
    if (hist.length === 0) return { series: [], open: 0 };
    let open = 0;
    const inWin: VitalityPoint[] = [];
    for (const p of hist) {
      if (p.t < range.sinceMs) open = p.v;
      else inWin.push(p);
    }
    const start = { t: range.sinceMs, v: open };
    const series = inWin.length ? [start, ...inWin] : [start, { t: nowMs, v: open }];
    return { series, open };
  };

  const b = clip(bHist);
  const c = clip(cHist);

  return {
    range,
    believers,
    capitalEth: capital,
    believersSeries: b.series,
    capitalSeries: c.series,
    believersDelta: believers - b.open,
    capitalDeltaEth: capital - c.open,
    believerEvents: bHist.filter((p) => p.t >= range.sinceMs).length,
    capitalEvents: cHist.filter((p) => p.t >= range.sinceMs).length,
    firstBelieverAt,
    lastEventAt: sorted.length ? sorted[sorted.length - 1].t : null,
    entrants24h,
    netEth24h,
  };
}

const rising = (n: number, eps: number) => n > eps;
const falling = (n: number, eps: number) => n < -eps;

/**
 * One calm sentence about the relationship between people and money. Never
 * mentions a side, never uses trading hype.
 */
export function vitalityStory(v: MarketVitality, capitalEpsEth = 1e-9): string {
  if (v.lastEventAt == null) return "Conviction is just beginning to form.";
  if (v.believerEvents + v.capitalEvents === 0) return "The market is quiet right now.";

  const b = v.believersDelta;
  const c = v.capitalDeltaEth;
  const bUp = rising(b, 0);
  const bDown = falling(b, 0);
  const cUp = rising(c, capitalEpsEth);
  const cDown = falling(c, capitalEpsEth);

  if (v.believers <= 1 && v.capitalEvents <= 3) return "Conviction is just beginning to form.";
  if (bUp && cUp) {
    // Who is leading? Compare each against its own starting base.
    const bBase = Math.max(1, v.believers - b);
    const cBase = Math.max(capitalEpsEth, v.capitalEth - c);
    const bRate = b / bBase;
    const cRate = c / cBase;
    if (bRate > cRate * 1.5) return "Interest is spreading, but commitment remains cautious.";
    if (cRate > bRate * 1.5) return "A small group is increasing its commitment.";
    return "More people are joining, and capital is following.";
  }
  if (bUp && cDown) return "More people are entering, but less capital remains committed.";
  if (!bUp && !bDown && cUp) return "The same believers are backing their conviction more heavily.";
  if (bDown && !cUp && !cDown)
    return "Participation is narrowing, while remaining capital is holding.";
  if (bDown && cDown) return "Interest and committed capital are cooling.";
  if (bDown && cUp) return "Fewer people remain, but they are committing more.";
  if (bUp) return "More people are joining.";
  return "The market is quiet right now.";
}
