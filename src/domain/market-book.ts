/**
 * MARKET BOOK — the one canonical current-position reducer.
 *
 * Every headline number in the product — the center's Market Believers / Market
 * Capital, and each side panel's YES/NO Believers / Capital — comes from HERE, so
 * they can never disagree:
 *
 *     Market Believers = Yes Believers + No Believers
 *     Market Capital   = Yes Capital  + No Capital
 *
 * It replays the authoritative trade tape into each wallet's CURRENT economic
 * state (committed value still standing on each side — never lifetime volume or
 * capital that has already exited), then classifies each wallet by its net
 * directional stance:
 *
 *     stance = (yes − no) / (yes + no)   in [−1, +1]
 *       ≥ +THRESHOLD → a YES believer
 *       ≤ −THRESHOLD → a NO believer
 *       otherwise, with value → MIXED  (holds both; a believer for neither)
 *       no value             → INACTIVE (exited; counts for no one)
 *
 * Capital is per-token, so a mixed wallet still contributes its real value to
 * each side — it just isn't a directional believer. Believer counts exclude mixed
 * and inactive from all three totals, which is exactly why they reconcile.
 *
 * ZERO IO, pure, fully testable.
 */
import type { TapeTrade } from "./conviction-series";
import type { VitalityPoint } from "./market-vitality";

/** Net stance magnitude at/above which a wallet is a directional believer. */
export const DIRECTIONAL_THRESHOLD = 0.1;
/** Committed value below this (in ETH) is treated as no value at all. */
export const ACTIVE_EPS = 1e-9;

const DAY = 86_400_000;

export type WalletState = "yes" | "no" | "mixed" | "inactive";

/** Classify a wallet from its current committed value on each side. */
export function classifyWallet(yes: number, no: number): WalletState {
  const total = yes + no;
  if (total <= ACTIVE_EPS) return "inactive";
  const stance = (yes - no) / total;
  if (stance >= DIRECTIONAL_THRESHOLD) return "yes";
  if (stance <= -DIRECTIONAL_THRESHOLD) return "no";
  return "mixed";
}

export type BookWindowKind = "since-open" | "1h" | "24h" | "7d" | "30d";

export interface BookWindow {
  kind: BookWindowKind;
  sinceMs: number;
  /** Heading suffix, e.g. "SINCE OPEN" / "24H" / "7D". */
  short: string;
  /** Absolute-change suffix, e.g. "since open" / "over 24H" / "over 7D". */
  since: string;
}

/** The window words for an explicitly selected timeframe. */
const SELECTED: Record<Exclude<FlowWindow, "all">, { kind: BookWindowKind; short: string }> = {
  "1h": { kind: "1h", short: "1H" },
  "24h": { kind: "24h", short: "1D" },
  "7d": { kind: "7d", short: "1W" },
  "30d": { kind: "30d", short: "1M" },
};

/**
 * The window every number is measured over. When the caller passes an explicit
 * `win` (the single on-screen timeframe control), that selection wins outright —
 * totals, deltas, percentages and sparklines all quote it. Without one it stays
 * adaptive: a young market shows its whole life, older ones a fixed window.
 */
export function bookWindow(
  firstEventAt: number | null,
  nowMs: number,
  win?: FlowWindow,
): BookWindow {
  const sinceOpen: BookWindow = {
    kind: "since-open",
    sinceMs: firstEventAt ?? nowMs,
    short: "SINCE OPEN",
    since: "since open",
  };
  if (win) {
    if (win === "all") return sinceOpen;
    const s = SELECTED[win];
    return {
      kind: s.kind,
      sinceMs: nowMs - FLOW_WINDOW_MS[win],
      short: s.short,
      since: `over ${s.short}`,
    };
  }
  const ageMs = firstEventAt == null ? 0 : nowMs - firstEventAt;
  if (firstEventAt == null || ageMs < DAY) return sinceOpen;
  if (ageMs <= 7 * DAY)
    return { kind: "24h", sinceMs: nowMs - DAY, short: "24H", since: "over 24H" };

  return { kind: "7d", sinceMs: nowMs - 7 * DAY, short: "7D", since: "over 7D" };
}

/** One metric's current value, its step history in the window, and its move. */
export interface BookMetric {
  current: number;
  series: VitalityPoint[];
  /** current − value when the window opened. */
  delta: number;
  /** value when the window opened (i.e. current − delta) — the % base. */
  base: number;
  /** step changes inside the window (drives cold-start copy). */
  events: number;
}

export interface MarketBook {
  window: BookWindow;
  believers: { market: BookMetric; yes: BookMetric; no: BookMetric };
  /** Capital in ETH — the caller applies the live USD rate. */
  capitalEth: { market: BookMetric; yes: BookMetric; no: BookMetric };
  /** Wallets currently holding BOTH sides (a believer for neither). */
  mixedParticipants: number;
  /** Wallets that once held a position but have fully exited. */
  inactiveParticipants: number;
  firstEventAt: number | null;
  lastEventAt: number | null;
}

/** Clip a raw step history to the window: one opening point + the in-window steps. */
function clip(hist: VitalityPoint[], sinceMs: number, nowMs: number): BookMetric {
  if (hist.length === 0) {
    return { current: 0, series: [{ t: sinceMs, v: 0 }], delta: 0, base: 0, events: 0 };
  }
  let open = 0;
  const inWin: VitalityPoint[] = [];
  for (const p of hist) {
    if (p.t < sinceMs) open = p.v;
    else inWin.push(p);
  }
  const current = hist[hist.length - 1].v;
  const start = { t: sinceMs, v: open };
  const series = inWin.length ? [start, ...inWin] : [start, { t: nowMs, v: open }];
  return { current, series, delta: current - open, base: open, events: inWin.length };
}

type Book = { yes: number; no: number };

/**
 * Replay the tape into the canonical book. `nowMs` fixes the window; the current
 * totals are the end state regardless of window.
 */
export function marketBook(tape: TapeTrade[], nowMs: number): MarketBook {
  const sorted = tape.filter((t) => Number.isFinite(t.t)).sort((a, b) => a.t - b.t);
  const firstEventAt = sorted.length ? sorted[0].t : null;
  const window = bookWindow(firstEventAt, nowMs);

  const books = new Map<string, Book>();
  let yesB = 0;
  let noB = 0;
  let yesC = 0;
  let noC = 0;

  // Step histories. Believer histories only get a point when the count changes;
  // capital changes on essentially every trade.
  const hMarketB: VitalityPoint[] = [];
  const hYesB: VitalityPoint[] = [];
  const hNoB: VitalityPoint[] = [];
  const hMarketC: VitalityPoint[] = [];
  const hYesC: VitalityPoint[] = [];
  const hNoC: VitalityPoint[] = [];

  for (const t of sorted) {
    const eth = Number.isFinite(t.eth) ? Math.max(0, t.eth) : 0;
    const book = books.get(t.w) ?? { yes: 0, no: 0 };
    const beforeState = classifyWallet(book.yes, book.no);

    // Apply the trade to this wallet's committed value on the traded side.
    const before = t.side === "YES" ? book.yes : book.no;
    const after = t.action === "BUY" ? before + eth : Math.max(0, before - eth);
    if (t.side === "YES") {
      book.yes = after;
      yesC = Math.max(0, yesC + (after - before));
    } else {
      book.no = after;
      noC = Math.max(0, noC + (after - before));
    }
    books.set(t.w, book);

    // Believer membership transition (stance crossing the directional boundary).
    const afterState = classifyWallet(book.yes, book.no);
    if (afterState !== beforeState) {
      if (beforeState === "yes") yesB -= 1;
      if (beforeState === "no") noB -= 1;
      if (afterState === "yes") yesB += 1;
      if (afterState === "no") noB += 1;
      hYesB.push({ t: t.t, v: yesB });
      hNoB.push({ t: t.t, v: noB });
      hMarketB.push({ t: t.t, v: yesB + noB });
    }
    hYesC.push({ t: t.t, v: yesC });
    hNoC.push({ t: t.t, v: noC });
    hMarketC.push({ t: t.t, v: yesC + noC });
  }

  let mixedParticipants = 0;
  let inactiveParticipants = 0;
  for (const b of books.values()) {
    const s = classifyWallet(b.yes, b.no);
    if (s === "mixed") mixedParticipants += 1;
    else if (s === "inactive") inactiveParticipants += 1;
  }

  const s = window.sinceMs;
  return {
    window,
    believers: {
      market: clip(hMarketB, s, nowMs),
      yes: clip(hYesB, s, nowMs),
      no: clip(hNoB, s, nowMs),
    },
    capitalEth: {
      market: clip(hMarketC, s, nowMs),
      yes: clip(hYesC, s, nowMs),
      no: clip(hNoC, s, nowMs),
    },
    mixedParticipants,
    inactiveParticipants,
    firstEventAt,
    lastEventAt: sorted.length ? sorted[sorted.length - 1].t : null,
  };
}
