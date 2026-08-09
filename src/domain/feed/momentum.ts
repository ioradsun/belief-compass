/**
 * MOMENTUM — what is changing, as a first-class feed dimension.
 *
 * WHAT THE FEED CALLED MOMENTUM BEFORE. `score.ts#momentum` was built from
 * `newBelievers1h`, `tradeCount1h`, `velocity5m`, `volumeUsd24h` and an
 * acceleration ratio — and `reasonFor` read `priceMovePct`, a raw percentage off
 * `chg_window_yes`. Two problems, both fatal to the meaning of the word:
 *
 *   1. IT WAS MOSTLY MEASURING THE DOLLAR. Every price and capital figure on
 *      this platform is stored in USD, and a share is worth a fixed 0.001 ETH
 *      until somebody trades it. So the dollar value of every market moves
 *      together with the exchange rate, having done nothing. Measured across 180
 *      markets over one 24h window, the USD price change was +1.44% at the 5th
 *      percentile, +1.59% at the 50th, and +1.59% at the 95th. Every market
 *      "moved" the same amount. `chg_24h_yes` is non-zero on all 2,764 rows for
 *      exactly this reason.
 *
 *      A fixed percentage bar cannot survive that. Below the drift it fires on
 *      every market at once; the day ETH moves 8% it would declare a major move
 *      on the entire platform and bury every real story under the currency.
 *
 *   2. THE ANSWER ALREADY EXISTED AND WAS DISCARDED. `loadWindowChanges` builds
 *      a full `MarketChange` — believers, capital and price, per side, against a
 *      real snapshot baseline — and `listFeed` pulled ONE scalar out of it
 *      (`pricePct(c, "YES")`) and dropped the rest. `market-change.ts` already
 *      has `currencyDrift` (the move the cross-section shares, i.e. the currency)
 *      and `materialMoves` (what cleared the bar net of it). The feed used none
 *      of it.
 *
 * SO MOMENTUM IS NOW DERIVED FROM `materialMoves`, drift-corrected, and this
 * module turns those moves into the reader's vocabulary.
 *
 * THE THRESHOLDS, AND WHY THEY ARE NOT `MATERIAL`'s.
 *
 * `MATERIAL` answers "is this a headline?" — it is the bar for interrupting a
 * feed with major news, and it is deliberately high: 5% net of drift, three
 * believers on one side. `MOMENTUM` answers a different question — "is this
 * MOVING?" — which a reader asks in order to go and look, not to be told
 * something. One new believer is movement. It is not news.
 *
 * Measured over 24h on the 180 markets with a baseline: 5 cleared 5% on price,
 * 13 cleared 5% on capital, and ZERO cleared three believers. A lens built on
 * the news bar would show an empty "New Believers" tab on a platform where 12
 * markets gained believers that day. Two jobs, two bars — and conflating them is
 * exactly how a lens ends up empty while the thing it names is happening.
 *
 * AND THE BAR IS WINDOW-AWARE, because the brief's question has a real answer:
 * over 24h, 12 markets gained a believer; over 7 days, 94 did. The same absolute
 * threshold means something different over each, so the count bars scale with the
 * window rather than pretending a day and a week are the same amount of time.
 *
 * ZERO IO, pure, fully testable.
 */
import type { MaterialMove, MarketChange, MoveBar, Sensitivity } from "@/domain/market-change";
import { barFor, materialMoves } from "@/domain/market-change";

/**
 * The reader's momentum vocabulary. Each is a QUESTION someone actually asks,
 * not a bucket the data happens to form.
 */
export type MomentumLens =
  | "moving" // anything at all is happening here
  | "gaining" // a side is climbing
  | "dropping" // a side is falling
  | "capital" // money is arriving or leaving
  | "believers" // people are arriving
  | "contested" // both sides are live and neither is winning
  | "waking"; // it was quiet and it is not any more

export const MOMENTUM_LENSES: MomentumLens[] = [
  "moving",
  "gaining",
  "dropping",
  "capital",
  "believers",
  "contested",
  "waking",
];

export const MOMENTUM_LABELS: Record<MomentumLens, string> = {
  moving: "Moving now",
  gaining: "Biggest gains",
  dropping: "Biggest drops",
  capital: "Capital flow",
  believers: "New believers",
  contested: "Contested",
  waking: "Waking up",
};

export const MOMENTUM = {
  /**
   * WHAT IS *NOT* HERE. The percentage, believer and capital floors used to be
   * declared in this object. They are rows in the one bar table now
   * (@/domain/market-change#BARS) — the momentum lens is simply the reader's
   * chosen row, and `barFor` is the only place those numbers exist. What
   * remains below is momentum's OWN: silence, contest and window scaling, none
   * of which any other surface asks about.
   */
  /**
   * Silent for this long, then traded → "waking up". Three days, because the
   * median pool market's last trade was 39 hours ago: a bar of one day would
   * call half the platform newly awake every time anything touched it.
   */
  quietHours: 72,
  /**
   * Contested needs both sides genuinely occupied. A market where one side has
   * everybody is not contested, it is decided.
   */
  contested: {
    /** Each side needs at least this many believers to be "live". */
    minSideBelievers: 1,
    /** Neither side may hold more than this share of the money. */
    maxMoneyShare: 0.7,
  },
  /**
   * How the count bars scale with the reader's window. A day and a week are not
   * the same amount of time and must not carry the same threshold.
   */
  windowScale: { "1h": 1, "24h": 1, "7d": 2, "30d": 3, all: 3 } as Record<string, number>,
} as const;

/** Everything momentum needs that is not already in a `MarketChange`. */
export interface MomentumContext {
  /** The reader's window, so the count bars can scale with it. */
  window: string;
  /** Believers now, per side — for `contested`. */
  believersYes: number;
  believersNo: number;
  /** Share of capital on YES, 0..1 — for `contested`. */
  moneyYesShare: number | null;
  /** Seconds of silence before the most recent trade — for `waking`. */
  inactiveForSeconds: number | null;
  /** Whether anything traded inside the reader's window at all. */
  tradedInWindow: boolean;
  /**
   * The reader's own floor. Absent means the default, which is today's
   * behaviour — see DEFAULT_SENSITIVITY.
   */
  sensitivity?: Sensitivity;
}

export interface MomentumFacts {
  /** Every lens this market belongs in. Empty on a still market. */
  lenses: MomentumLens[];
  /** The single most significant move, or null. Drives the reason. */
  top: MaterialMove | null;
  /**
   * Every move that cleared the bar, heaviest first.
   *
   * Kept — not reduced to `top` — so a stricter reader can be served by
   * FILTERING this rather than by recomputing the change. See `atSensitivity`:
   * the classification is done once, in the shared cached block, at the most
   * permissive bar, and every reader's view is a subset of it. Reducing to
   * `top` here would break that, because the heaviest move is not always the
   * one that clears a given bar — a believer crowd can rank below a capital
   * move and still be the only thing that survives a believer threshold.
   */
  moves: MaterialMove[];
  /**
   * 0..1 significance, for the ranker. Zero when nothing moved — which is the
   * honest reading and is what lets a quiet market lose to a live one instead of
   * both scoring on volume.
   */
  weight: number;
}

export const NO_MOMENTUM: MomentumFacts = { lenses: [], top: null, moves: [], weight: 0 };

const scale = (window: string): number => MOMENTUM.windowScale[window] ?? 1;

/**
 * The bar this lens hands to `materialMoves`.
 *
 * It MUST be passed down rather than applied afterwards. `materialMoves`
 * defaults to `MATERIAL`, so a lens that filtered its output at 3% would be
 * filtering a list from which everything under 5% had already been removed — a
 * threshold that can never bind, which is the failure this codebase keeps
 * producing and which this very module nearly shipped.
 */
export function momentumBar(window: string, sensitivity?: Sensitivity): MoveBar {
  // The reader's own floor is a ROW IN THE ONE TABLE, not a second set of
  // numbers — see @/domain/market-change#BARS. Only the window scaling is
  // momentum's own, because a day and a week are not the same amount of time
  // and no shared table can know which one the reader is looking at.
  const base = barFor(sensitivity);
  return { ...base, minBelieverDelta: base.minBelieverDelta * scale(window) };
}

/**
 * A last dust filter the bar cannot express.
 *
 * The dollar floor belongs to CAPITAL only. A price is per-share — around $1.90
 * here — so a 5% price move has a delta of about nine cents by construction, and
 * a dollar floor applied to it would silently delete every price move there is.
 */
function notDust(m: MaterialMove, bar: MoveBar): boolean {
  return m.metric !== "capital" || Math.abs(m.delta) >= bar.minUsd;
}

/**
 * Which lenses this market belongs in, what its strongest move is, and how much
 * it should weigh.
 *
 * A market can be in several lenses at once and that is correct — "Moving now"
 * and "Capital flow" are not competing claims. What it gets exactly one of is a
 * REASON, which is `top`.
 */
export function classifyMomentum(
  change: MarketChange | null,
  ctx: MomentumContext,
  driftPct: number | null = 0,
): MomentumFacts {
  const lenses = new Set<MomentumLens>();

  // Contested and waking are states, not moves: a market can be contested while
  // perfectly still, and "it woke up" is a fact about the silence before it.
  const bothLive =
    ctx.believersYes >= MOMENTUM.contested.minSideBelievers &&
    ctx.believersNo >= MOMENTUM.contested.minSideBelievers;
  const balanced =
    ctx.moneyYesShare != null &&
    ctx.moneyYesShare <= MOMENTUM.contested.maxMoneyShare &&
    ctx.moneyYesShare >= 1 - MOMENTUM.contested.maxMoneyShare;
  if (bothLive && balanced) lenses.add("contested");

  if (
    ctx.tradedInWindow &&
    ctx.inactiveForSeconds != null &&
    ctx.inactiveForSeconds >= MOMENTUM.quietHours * 3600
  ) {
    lenses.add("waking");
  }

  const bar = momentumBar(ctx.window, ctx.sensitivity);
  const moves = change ? materialMoves(change, driftPct, bar).filter((m) => notDust(m, bar)) : [];
  for (const m of moves) {
    lenses.add("moving");
    if (m.metric === "capital") lenses.add("capital");
    if (m.metric === "believers") lenses.add("believers");
    // Direction is about the SIDE that moved, which is what a reader watching
    // for a rally or a rout is actually asking about.
    if (m.direction === "up") lenses.add("gaining");
    else lenses.add("dropping");
  }

  const top = moves[0] ?? null;
  // `waking` carries weight with no move behind it: a market breaking a
  // three-day silence is a real event even when the trade that broke it was
  // small, and it is the one signal `materialMoves` structurally cannot see.
  const base = top?.weight ?? 0;
  const woke = lenses.has("waking") ? 0.45 : 0;
  return {
    lenses: MOMENTUM_LENSES.filter((l) => lenses.has(l)),
    top,
    moves,
    weight: Math.max(base, woke),
  };
}

import { MATERIAL_USD } from "../transition-denominator";

const pct = (x: number): string =>
  `${Math.abs(x) >= 10 ? Math.round(Math.abs(x)) : Math.abs(x).toFixed(1)}%`;
const usd = (x: number): string => {
  const a = Math.abs(x);
  return a >= 1000
    ? `$${Math.round(a / 100) / 10}k`
    : a >= 10
      ? `$${Math.round(a)}`
      : `$${a.toFixed(2)}`;
};
const people = (n: number): string =>
  `${Math.abs(n)} ${Math.abs(n) === 1 ? "believer" : "believers"}`;

/**
 * The one sentence for a momentum move.
 *
 * SPECIFIC OR NOTHING. "Trending", "Popular", "Active" say only that the feed
 * wanted to show you something; every sentence here names the metric, the side,
 * the direction and the size, because that is what makes it checkable. A reader
 * who opens the market can verify any of these in one glance, and a reason that
 * survives being checked is the only kind worth printing.
 */
export function momentumReason(m: MaterialMove, window: string): string {
  const side = m.side ?? "the market";
  const win = window === "24h" ? "today" : window === "1h" ? "this hour" : `over ${window}`;

  if (m.kind === "arrival") {
    return m.metric === "capital"
      ? `First money into ${side} — ${usd(m.delta)}`
      : `First believer on ${side}`;
  }
  if (m.metric === "believers") {
    return m.delta > 0
      ? `${side} gained ${people(m.delta)} ${win}`
      : `${side} lost ${people(m.delta)} ${win}`;
  }
  if (m.metric === "capital") {
    // A PERCENTAGE OF POCKET CHANGE IS NOT NEWS. "up 62%" on a side holding $8
    // is arithmetic dressed as momentum; the dollar figure is both smaller and
    // more honest, so below the material floor the size replaces the rate.
    const moved = Math.abs(m.delta ?? 0);
    if (moved > 0 && moved < MATERIAL_USD)
      return m.direction === "up"
        ? `${usd(moved)} into ${side} ${win}`
        : `${usd(moved)} off ${side} ${win}`;
    // A total exit is a DEPARTURE, not a rate — the mirror image of an arrival,
    // and the largest thing that can happen to a side in the other direction.
    // "down 100%" is technically true and reads like a rounding artefact.
    if ((m.pct ?? 0) <= -100) return `All capital left ${side}`;
    return m.direction === "up"
      ? `Capital into ${side} up ${pct(m.pct ?? 0)} ${win}`
      : `Capital leaving ${side} — down ${pct(m.pct ?? 0)} ${win}`;
  }
  return m.direction === "up"
    ? `${side} moved up ${pct(m.pct ?? 0)} ${win}`
    : `${side} moved down ${pct(m.pct ?? 0)} ${win}`;
}

/** The sentence for a market that woke up — no move required. See `classifyMomentum`. */
export const WAKING_REASON = "This market just woke up";

/** The sentence for a contested market. */
export const CONTESTED_REASON = "Both sides are live and neither is winning";

/**
 * The same facts, seen through a stricter reader's floor.
 *
 * WHY THIS EXISTS RATHER THAN A SECOND CLASSIFICATION. `classifyMomentum` runs
 * in the viewer-independent block every reader shares through one SWR cache.
 * Passing a per-reader threshold in there would split that cache three ways per
 * window and recompute the same market changes for each — to produce an answer
 * that is always a SUBSET of the permissive one. So the change is classified
 * once, at the lowest bar, and this filters what survives.
 *
 * THE STATES ARE NOT FILTERED. `contested` describes a market that is evenly
 * held; `waking` describes a silence that broke. Neither has a magnitude for a
 * threshold to act on, and a reader asking for bigger MOVES is not asking to
 * stop being told that a market woke up.
 */
export function atSensitivity(
  facts: MomentumFacts,
  sensitivity: Sensitivity | undefined,
  window: string,
): MomentumFacts {
  const bar = momentumBar(window, sensitivity);
  const kept = facts.moves.filter((m) => clears(m, bar));
  if (kept.length === facts.moves.length) return facts;

  const lenses = new Set<MomentumLens>();
  if (facts.lenses.includes("contested")) lenses.add("contested");
  if (facts.lenses.includes("waking")) lenses.add("waking");
  for (const m of kept) {
    lenses.add("moving");
    if (m.metric === "capital") lenses.add("capital");
    if (m.metric === "believers") lenses.add("believers");
    lenses.add(m.direction === "up" ? "gaining" : "dropping");
  }
  const woke = lenses.has("waking") ? 0.45 : 0;
  return {
    lenses: MOMENTUM_LENSES.filter((l) => lenses.has(l)),
    top: kept[0] ?? null,
    moves: kept,
    weight: Math.max(kept[0]?.weight ?? 0, woke),
  };
}

/** Does an already-derived move clear `bar`? The same rule `rate`/`crowd` applied. */
function clears(m: MaterialMove, bar: MoveBar): boolean {
  if (m.metric === "believers") return Math.abs(m.delta) >= bar.minBelieverDelta;
  if (m.kind === "arrival") return Math.abs(m.delta) >= bar.minOriginUsd;
  if (m.pct == null) return false;
  if (Math.abs(m.pct) < bar.minPct) return false;
  return m.metric !== "capital" || Math.abs(m.delta) >= bar.minUsd;
}
