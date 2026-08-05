/**
 * MARKET DISCOVERY — what a search result actually says.
 *
 * A search result is a decision, not a filing card. Scanning a list, a person
 * asks: is this the conversation I meant, and is anything happening in it? A
 * static "95% YES · 36 believers" answers neither — it's a snapshot with no
 * direction. So each result leads with a plain sentence about the market's
 * MOMENTUM, supported by exactly two numbers:
 *
 *   Participants  — did people ever care?   (lifetime reach, social proof)
 *   Market cap    — do they still care?     (capital committed right now)
 *
 * The internal state names below (new / emerging / growing / active / cooling /
 * dormant / exited) never appear in the interface; only the sentences do.
 *
 * ZERO IO, deterministic, fully testable.
 */

export type MarketStage =
  | "new"
  | "emerging"
  | "growing"
  | "active"
  | "cooling"
  | "dormant"
  | "exited";

export interface DiscoveryInput {
  /** Unique wallets that have EVER traded this market. */
  participants: number | null | undefined;
  /** Directional believers holding right now. */
  believers: number | null | undefined;
  /** Capital currently committed, in USD. */
  capitalUsd: number | null | undefined;
  /** Epoch ms of the first and last trade, when known. */
  firstActivityAt?: number | null;
  lastActivityAt?: number | null;
  /** Wallets that arrived in the last 24h (new believers), when known. */
  joined24h?: number | null;
  nowMs: number;
}

export interface DiscoveryRow {
  stage: MarketStage;
  /** The one-line story, e.g. "Believers are joining." */
  story: string;
  /** "247 participants" — lifetime reach, or null when nobody ever traded. */
  participantsText: string | null;
  /** "$18.2K market cap" — always shown once anyone has participated. */
  capText: string | null;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Below a cent, committed capital is float dust, not conviction. */
const DUST_USD = 0.01;

const n = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;

/** Compact money for a dense row: $0, $940, $18.2K, $1.4M. */
export function compactUsd(v: number): string {
  const x = Math.max(0, v);
  if (x < DUST_USD) return "$0";
  if (x < 1_000) return `$${x < 10 ? x.toFixed(2) : Math.round(x)}`;
  if (x < 1_000_000) return `$${(x / 1_000).toFixed(x < 10_000 ? 1 : 0)}K`;
  return `$${(x / 1_000_000).toFixed(1)}M`;
}

/** The internal stage — the only place the lifecycle rules live. */
export function marketStage(i: DiscoveryInput): MarketStage {
  const participants = Math.floor(n(i.participants));
  const believers = Math.floor(n(i.believers));
  const capital = n(i.capitalUsd);
  const held = capital >= DUST_USD;

  if (participants === 0 && !held) return "new";
  // Everyone who ever showed up has left: reach without conviction.
  if (!held && believers === 0) return "exited";

  const last = i.lastActivityAt ?? null;
  const first = i.firstActivityAt ?? null;
  const sinceLast = last == null ? Infinity : Math.max(0, i.nowMs - last);
  const age = first == null ? Infinity : Math.max(0, i.nowMs - first);
  const joined = Math.floor(n(i.joined24h));

  if (sinceLast > 21 * DAY) return "dormant";
  if (sinceLast > 7 * DAY) return "cooling";
  // Young and already attracting people — conviction is still forming.
  if (age < 2 * DAY && participants <= 3) return "emerging";
  if (joined > 0 || sinceLast <= DAY) return "growing";
  return "active";
}

const STORY: Record<MarketStage, string> = {
  new: "Waiting for the first believer.",
  emerging: "Conviction is forming.",
  growing: "Believers are joining.",
  active: "An active market.",
  cooling: "Activity has slowed.",
  dormant: "Waiting for new conviction.",
  exited: "Waiting for the next believer.",
};

export function composeDiscoveryRow(i: DiscoveryInput): DiscoveryRow {
  const stage = marketStage(i);
  const participants = Math.floor(n(i.participants));
  const capital = n(i.capitalUsd);

  return {
    stage,
    story: STORY[stage],
    participantsText:
      participants > 0 ? `${participants.toLocaleString("en-US")} participant${participants === 1 ? "" : "s"}` : null,
    capText: stage === "new" ? null : `${compactUsd(capital)} market cap`,
  };
}
