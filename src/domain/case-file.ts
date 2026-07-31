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

/* ── The people: ONE relationship badge, ONE optional status ────────────────── */

/**
 * A believer's RELATIONSHIP to the viewer — the single primary badge. There is
 * always exactly one; "unmapped" means the DNA hasn't placed them yet. This is
 * the only classification of its kind, so nothing competes with it.
 */
export type CaseRelationship = "twin" | "tribe" | "rival" | "inverse" | "unmapped";

export const RELATIONSHIP_LABEL: Record<CaseRelationship, string> = {
  twin: "Twin",
  tribe: "Tribe",
  rival: "Rival",
  inverse: "Inverse",
  unmapped: "Unmapped",
};

/** Strongest tie first; unmapped holders sit last. */
export const RELATIONSHIP_RANK: Record<CaseRelationship, number> = {
  twin: 4,
  tribe: 3,
  rival: 2,
  inverse: 1,
  unmapped: 0,
};

/** Map the network's raw label to the case's single relationship badge. */
export function caseRelationship(relationship: string | null | undefined): CaseRelationship {
  switch (relationship) {
    case "twin":
      return "twin";
    case "tribe":
      return "tribe";
    case "opp":
      return "rival";
    case "inverse":
      return "inverse";
    default:
      return "unmapped";
  }
}

/**
 * A believer's STATUS — a secondary, optional note about their position, NOT a
 * relationship. At most one shows, so "Whale" never reads like it's the same
 * kind of thing as "Tribe".
 */
export type CaseStatus = "whale" | "long_term" | "new";

export const STATUS_LABEL: Record<CaseStatus, string> = {
  whale: "Whale",
  long_term: "Long-term",
  new: "New",
};

/** Held this many days or more counts as a long-term holder. */
export const LONG_TERM_DAYS = 30;

/** The single most notable status for a holder, or null. Money → time → newness. */
export function believerStatus(daysHeld: number, whale: boolean): CaseStatus | null {
  if (whale) return "whale";
  if (daysHeld >= LONG_TERM_DAYS) return "long_term";
  if (daysHeld <= 1) return "new";
  return null;
}

export interface RankedBeliever<T> {
  believer: T;
  relationship: CaseRelationship;
  status: CaseStatus | null;
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
 * The single roster (People + Network merged): your closest ties first, then the
 * biggest money, then the deepest conviction, then the longest holders. `relOf`
 * returns the viewer's raw relationship to a wallet, or null.
 */
export function rankBelievers<T extends RankableBeliever>(
  believers: T[],
  relOf: (wallet: string) => string | null | undefined,
): RankedBeliever<T>[] {
  return believers
    .map((b) => ({
      believer: b,
      relationship: caseRelationship(relOf(b.wallet.toLowerCase())),
      status: believerStatus(b.daysHeld, b.whale),
    }))
    .sort(
      (a, b) =>
        RELATIONSHIP_RANK[b.relationship] - RELATIONSHIP_RANK[a.relationship] ||
        (b.believer.whale ? 1 : 0) - (a.believer.whale ? 1 : 0) ||
        b.believer.valueUsd - a.believer.valueUsd ||
        b.believer.conviction - a.believer.conviction ||
        b.believer.daysHeld - a.believer.daysHeld,
    );
}

/** Human "held" duration from whole days — "Held 43 days", "New today". */
export function heldFor(daysHeld: number): string {
  const d = Math.max(0, Math.floor(daysHeld));
  if (d <= 0) return "New today";
  if (d === 1) return "Held 1 day";
  if (d < 30) return `Held ${d} days`;
  if (d < 60) return "Held 1 month";
  if (d < 365) return `Held ${Math.floor(d / 30)} months`;
  const years = Math.floor(d / 365);
  return years === 1 ? "Held 1 year" : `Held ${years} years`;
}
