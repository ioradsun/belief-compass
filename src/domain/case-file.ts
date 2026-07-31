/**
 * Case File — one side's story, told from the trade tape and the holder roster.
 *
 * The panel is a single argument with a beginning, middle, and end:
 *   1. THE CLAIM  — how many believers, how much money, what price, right now —
 *      each with its % change over the timeframe the reader picked.
 *   2. THE MOVEMENT — the shape of that change and the latest beats.
 *   3. THE PEOPLE — the actual believers, each tagged with the group they belong
 *      to (your Twin/Tribe/Rival/… or just a Believer) and how long they've held.
 *
 * This module owns acts 1 and 3 as pure functions. It never invents a number and
 * never merges two periods: every % is measured against the start of the one
 * window in view. Money stays in ETH here; the caller applies the live USD rate.
 */
import type { FlowWindow } from "./market-flow";
import {
  convictionSeries,
  convictionStory,
  type SeriesPoint,
  type TapeTrade,
} from "./conviction-series";

export interface SideCaseSummary {
  /** Cumulative believers on this side, now. */
  believers: number;
  /** % change in believers over the selected window. */
  believersPct: number;
  /** Capital backing this side now, in ETH (caller × USD rate). */
  capitalEth: number;
  capitalPct: number;
  /** Last per-share price on this side, in ETH; null before the first trade. */
  priceEth: number | null;
  pricePct: number | null;
  /** The believers curve for the sparkline. */
  series: SeriesPoint[];
  /** One honest sentence about the window's move ("YES is gaining believers"). */
  headline: string | null;
}

/**
 * The three headline totals + their window-relative % change, for one side. Null
 * when this side has no trades at all (nothing to argue yet).
 */
export function sideCaseSummary(
  tape: TapeTrade[],
  side: "YES" | "NO",
  win: FlowWindow,
  nowMs: number,
): SideCaseSummary | null {
  const series = convictionSeries(tape, side, win, nowMs);
  if (series.length === 0) return null;
  const last = series[series.length - 1];
  const story = convictionStory(side, series);
  return {
    believers: last.believers,
    believersPct: last.believersPct,
    capitalEth: last.capital,
    capitalPct: last.capitalPct,
    priceEth: last.price,
    pricePct: last.pricePct,
    series,
    headline: story?.headline ?? null,
  };
}

/* ── The people: one list, each believer placed in a group ─────────────────── */

export type BelieverGroup = "twin" | "tribe" | "rival" | "inverse" | "match" | "whale" | "believer";

/** How each group reads in the case — your relationship, or the plain roster. */
export const GROUP_LABEL: Record<BelieverGroup, string> = {
  twin: "Twin",
  tribe: "Tribe",
  rival: "Rival",
  inverse: "Inverse",
  match: "Match",
  whale: "Whale",
  believer: "Believer",
};

/** Strongest first — network ties outrank a big wallet outranks a plain holder. */
export const GROUP_RANK: Record<BelieverGroup, number> = {
  twin: 6,
  tribe: 5,
  rival: 4,
  inverse: 3,
  match: 2,
  whale: 1,
  believer: 0,
};

/**
 * The one place People and Network merge: a believer's group is their
 * relationship to the viewer when there is one, otherwise "Whale" (big money) or
 * a plain "Believer". No separate lists, no duplicate person.
 */
export function believerGroup(
  relationship: string | null | undefined,
  whale: boolean,
): BelieverGroup {
  switch (relationship) {
    case "twin":
      return "twin";
    case "tribe":
      return "tribe";
    case "opp":
      return "rival";
    case "inverse":
      return "inverse";
    case "neutral":
      return "match";
    default:
      return whale ? "whale" : "believer";
  }
}

export interface RankedBeliever<T> {
  believer: T;
  group: BelieverGroup;
}

/** The minimum a believer must carry to be ranked into the list. */
export interface RankableBeliever {
  wallet: string;
  conviction: number;
  valueUsd: number;
  daysHeld: number;
  whale: boolean;
}

/**
 * Merge People + Network into a single ordered roster: your closest people
 * first, then the biggest money, then the deepest conviction, then the longest
 * holders. `relOf` returns the viewer's relationship to a wallet, or null.
 */
export function rankBelievers<T extends RankableBeliever>(
  believers: T[],
  relOf: (wallet: string) => string | null | undefined,
): RankedBeliever<T>[] {
  return believers
    .map((b) => ({ believer: b, group: believerGroup(relOf(b.wallet.toLowerCase()), b.whale) }))
    .sort(
      (a, b) =>
        GROUP_RANK[b.group] - GROUP_RANK[a.group] ||
        b.believer.valueUsd - a.believer.valueUsd ||
        b.believer.conviction - a.believer.conviction ||
        b.believer.daysHeld - a.believer.daysHeld,
    );
}

/** Human "held" duration from whole days. Compact, honest, no decimals. */
export function heldFor(daysHeld: number): string {
  const d = Math.max(0, Math.floor(daysHeld));
  if (d <= 0) return "new today";
  if (d === 1) return "held 1 day";
  if (d < 30) return `held ${d} days`;
  if (d < 60) return "held 1 month";
  if (d < 365) return `held ${Math.floor(d / 30)} months`;
  const years = Math.floor(d / 365);
  return years === 1 ? "held 1 year" : `held ${years} years`;
}
