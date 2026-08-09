/**
 * STANDING IS A STORY TYPE, NOT A FEED LANE.
 *
 * Insider watches people, money, price, behaviour and persistence. A story does
 * not need a new transaction to be interesting: sometimes the clue is that
 * something changed, and sometimes the clue is that something DIDN'T.
 *
 * This module turns "who is still here" into ordinary Insider candidates so they
 * can enter the same pipeline as everything else — significance, editorial
 * subtraction, diversity, the question layer — and earn their slot by
 * information value rather than by waiting for the feed to go silent.
 *
 * TWO CLASSES, DELIBERATELY UNEQUAL.
 *
 *   RECEIPT       Persistence that is true and not very informative.
 *                 "Rummy has backed YES for 18 days."
 *                 Low strength by construction. It should surface when the
 *                 candidate pool is weak and lose when it is not.
 *
 *   INTELLIGENCE  Persistence that CONTRASTS with a proven change, which is
 *                 where the information actually lives.
 *                 "YES fell 9%. Three long-held positions are still there."
 *                 It competes normally, and because it carries real market
 *                 facts it gets a real SignalVector rather than a social zero.
 *
 * WHAT THIS MODULE MAY NOT DO:
 *   · invent an event, or a time at which one happened (see `timeless`);
 *   · infer motive, knowledge, confidence or causality ("the whale knows
 *     something", "they're waiting for X") — only the observable thing;
 *   · call anyone a whale without a proven holder hierarchy. The whale is
 *     established upstream by `findConvictionWhale`; nothing here promotes a
 *     large dollar amount into one.
 *
 * A note on IDENTITY. A standing truth is true across hundreds of polls, so the
 * key must be stable across them — but must also change when the EVIDENCE
 * RELATIONSHIP changes, because that genuinely is new information. Tenure is
 * therefore bucketed (day 18 and day 19 are one fact) while the contrast is
 * bucketed by magnitude (a 3% dip and a 14% fall are not).
 *
 * ZERO IO, pure, deterministic, fully testable.
 */
import {
  STANDING,
  findStandingFacts,
  heldText,
  nameThem,
  tellStandingFact,
  type StandingFact,
  type StandingHolder,
} from "./standing-fact";
import { LOUD_REL_MOVE, MATERIAL_CAPITAL } from "./signal-vector";
import type { Side } from "./story";

export const STANDING_INTEL = {
  /** Below this a hold is recent enough that "still there" is not a contrast. */
  minHoldDays: 7,
  /** One person holding through a move is an anecdote; several is a shape. */
  minHolders: 2,
  /** A price move small enough to be noise cannot make stillness informative. */
  minPriceMove: LOUD_REL_MOVE,
  /** How many proven departures it takes before "and they stayed" says anything. */
  minExits: 2,
  /** How long one side must have been occupied before the other's emptiness reads. */
  oneSidedMinDays: 7,
  /** Capital leaving, USD, before a lone holder remaining is a contrast. */
  minCapitalLeaving: MATERIAL_CAPITAL,
  /** A receipt may never claim more of the reader than this. */
  receiptCeiling: 0.3,
} as const;

export type StandingStoryKind =
  /** The base case: persistence, with nothing to contrast it against. */
  | "standing_receipt"
  /** Price moved materially; the long-held positions did not. */
  | "held_through_price_move"
  /** Smaller holders left; the proven largest long-held position remains. */
  | "whale_stayed_others_left"
  /** One side has been occupied for a long time; the other is still empty. */
  | "one_sided_persistence"
  /** Capital drained off this side; a long-tenured holder is still on it. */
  | "holder_stayed_capital_left";

export type StandingClass = "receipt" | "intelligence";

/** The proven, viewer-blind market facts a standing story may contrast against. */
export interface StandingEvidence {
  marketId: number;
  marketTitle: string;
  side: Side;
  /** Current holders of THIS side, already dust-filtered. */
  holders: StandingHolder[];
  /** Days since the market opened. Null → no founding claim. */
  marketAgeDays?: number | null;
  /**
   * Proven 24h relative move in THIS side's price (+0.09 = up 9%). Null means
   * it was never established, and the vector's rule applies: null is not zero.
   */
  sidePriceChange24h?: number | null;
  /** Proven departures from this side inside the feed window. */
  exits?: number | null;
  /** 24h change in capital held on this side, USD. Negative is leaving. */
  capitalDelta24h?: number | null;
  /** Believers on the OPPOSITE side right now. 0 is meaningful; null is unknown. */
  oppositeBelievers?: number | null;
  /**
   * The market's Conviction Whale, established from the actual holder
   * hierarchy (src/domain/conviction-whale). Never inferred from a big number.
   */
  whale?: { wallet: string; side: Side; daysHeld: number } | null;
}

export interface StandingStoryRow {
  kind: StandingStoryKind;
  klass: StandingClass;
  /** Stable across polls, unstable across a materially changed contrast. */
  key: string;
  marketId: number;
  marketTitle: string;
  side: Side;
  people: StandingHolder[];
  headline: string;
  body: string;
  /** 0..1 baseline significance, before any viewer boost the pipeline adds. */
  strength: number;
  /** Semantic identity for the mixer's window-wide variety caps. */
  motif: string;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const num = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * Day 18 and day 19 are the same fact. Bucketing tenure is what stops a true
 * thing being re-served as news once a day forever.
 */
export function tenureBucket(days: number): number {
  const d = Math.max(0, Math.floor(days));
  for (const b of [365, 180, 90, 60, 30, 14, 7, 3, 1]) if (d >= b) return b;
  return 0;
}

/** A contrast bucketed by magnitude: 3% and 14% are different evidence. */
function moveBucket(rel: number): string {
  const mag = Math.min(9, Math.floor(Math.abs(rel) / 0.05));
  return `${rel < 0 ? "-" : "+"}${mag}`;
}

/** A dollar contrast, bucketed by order of magnitude for the same reason. */
function usdBucket(usd: number): string {
  const mag = Math.max(0, Math.floor(Math.log10(Math.max(1, Math.abs(usd)))));
  return `e${mag}`;
}

const pct = (rel: number): string => `${Math.round(Math.abs(rel) * 100)}%`;

const moved = (rel: number, side: Side): string =>
  `${side} ${rel < 0 ? "fell" : "rose"} ${pct(rel)}`;

const other = (side: Side): Side => (side === "YES" ? "NO" : "YES");

const usdShort = (usd: number): string => {
  const v = Math.abs(Math.round(usd));
  return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`;
};

/** "Three positions" / "One position", said the way a person says it. */
const countPositions = (n: number): string =>
  `${n === 1 ? "One position" : `${n} positions`}`;

/** The long-held subset — the only holders a contrast may speak about. */
function longHeld(holders: readonly StandingHolder[]): StandingHolder[] {
  return holders
    .filter((h) => Number.isFinite(h.daysHeld) && h.daysHeld >= STANDING_INTEL.minHoldDays)
    .sort((a, b) => b.daysHeld - a.daysHeld || a.wallet.localeCompare(b.wallet));
}

/**
 * The standing INTELLIGENCE this side can honestly support. Persistence on its
 * own is never enough — every branch below needs a proven change to contrast
 * with, which is the whole distinction between a clue and a receipt.
 */
export function findStandingIntelligence(ev: StandingEvidence): StandingStoryRow[] {
  const out: StandingStoryRow[] = [];
  const held = longHeld(ev.holders);
  if (held.length === 0) return out;

  const base = `standing:${ev.marketId}:${ev.side}`;
  const lead = held[0]!;
  const move = num(ev.sidePriceChange24h);
  const exits = Math.max(0, num(ev.exits) ?? 0);
  const capital = num(ev.capitalDelta24h);
  const opposite = num(ev.oppositeBelievers);

  /* PRICE MOVED, THEY DIDN'T. The clearest case of change + non-change: the
     reader already knows the price moved, and what they do not know is that the
     people with the longest exposure to it are all still in. */
  if (move != null && Math.abs(move) >= STANDING_INTEL.minPriceMove && held.length >= STANDING_INTEL.minHolders) {
    const people = held.slice(0, STANDING.maxPeople);
    out.push({
      kind: "held_through_price_move",
      klass: "intelligence",
      key: `${base}:held_through_price_move:${moveBucket(move)}:${held.length}`,
      marketId: ev.marketId,
      marketTitle: ev.marketTitle,
      side: ev.side,
      people,
      headline: "THEY DIDN'T BUDGE",
      body: `${moved(move, ev.side)}. ${countPositions(held.length)} held ${heldText(
        lead.daysHeld,
        lead.tenureIsFloor === true,
      )} or more ${held.length === 1 ? "is" : "are"} still there.`,
      strength: clamp01(0.55 + Math.min(0.2, Math.abs(move)) + 0.04 * Math.min(3, held.length)),
      motif: `standing:held_through_price_move:${ev.side}`,
    });
  }

  /* THE HIERARCHY THINNED OUT AROUND ONE POSITION. Only sayable when the whale
     was ESTABLISHED from the holder hierarchy upstream, and only about the
     departures actually observed. No motive, ever — just who left and who is
     still there. */
  const whale = ev.whale;
  if (
    whale &&
    whale.side === ev.side &&
    exits >= STANDING_INTEL.minExits &&
    whale.daysHeld >= STANDING_INTEL.minHoldDays &&
    held.some((h) => h.wallet === whale.wallet)
  ) {
    const w = held.find((h) => h.wallet === whale.wallet)!;
    out.push({
      kind: "whale_stayed_others_left",
      klass: "intelligence",
      key: `${base}:whale_stayed:${whale.wallet}:${Math.min(9, exits)}`,
      marketId: ev.marketId,
      marketTitle: ev.marketTitle,
      side: ev.side,
      people: [w],
      headline: "THE BIGGEST POSITION STAYED",
      body: `${exits} smaller ${ev.side} ${exits === 1 ? "holder" : "holders"} left. The largest ${ev.side} position, held ${heldText(
        whale.daysHeld,
        w.tenureIsFloor === true,
      )}, is still there.`,
      strength: clamp01(0.6 + 0.05 * Math.min(4, exits)),
      motif: `standing:whale_stayed:${ev.side}`,
    });
  }

  /* ONE SIDE OCCUPIED, THE OTHER STILL EMPTY. An absence is only evidence when
     the presence opposite it has lasted — which is exactly what tenure proves.
     `opposite === 0` is a fact; `opposite == null` is ignorance, and ignorance
     says nothing. */
  if (opposite === 0 && lead.daysHeld >= STANDING_INTEL.oneSidedMinDays) {
    out.push({
      kind: "one_sided_persistence",
      klass: "intelligence",
      key: `${base}:one_sided:${tenureBucket(lead.daysHeld)}`,
      marketId: ev.marketId,
      marketTitle: ev.marketTitle,
      side: ev.side,
      people: held.slice(0, STANDING.maxPeople),
      headline: "STILL ONE-SIDED",
      body: `${ev.side} has had believers for ${heldText(
        lead.daysHeld,
        lead.tenureIsFloor === true,
      )}. ${other(ev.side)} still has nobody.`,
      strength: clamp01(0.5 + 0.25 * Math.min(1, lead.daysHeld / 60)),
      motif: `standing:one_sided:${ev.side}`,
    });
  }

  /* THE MONEY LEFT AND THE PERSON DIDN'T. Capital is the thing that moved;
     tenure is the thing that didn't. Both are read from state, neither is
     explained. */
  if (capital != null && capital <= -STANDING_INTEL.minCapitalLeaving && lead.daysHeld >= 14) {
    out.push({
      kind: "holder_stayed_capital_left",
      klass: "intelligence",
      key: `${base}:capital_left:${lead.wallet}:${usdBucket(capital)}`,
      marketId: ev.marketId,
      marketTitle: ev.marketTitle,
      side: ev.side,
      people: [lead],
      headline: "STILL THERE",
      body: `${nameThem([lead])} has held ${ev.side} for ${heldText(
        lead.daysHeld,
        lead.tenureIsFloor === true,
      )}. Capital on ${ev.side} is down ${usdShort(capital)} in 24 hours.`,
      strength: clamp01(0.5 + 0.15 * Math.min(1, Math.abs(capital) / 500)),
      motif: `standing:capital_left:${ev.side}`,
    });
  }

  return out.sort((a, b) => b.strength - a.strength || a.key.localeCompare(b.key));
}

/**
 * A plain persistence receipt, from the existing standing-fact grammar. Capped
 * at `receiptCeiling` so it can never routinely outrank real activity — the
 * quiet-feed slot it used to be handed by the scheduler is now something it has
 * to win by there being nothing better, which is the same outcome without the
 * separate lane.
 */
export function toReceipt(fact: StandingFact): StandingStoryRow {
  const told = tellStandingFact(fact);
  return {
    kind: "standing_receipt",
    klass: "receipt",
    key: `standing:${fact.marketId}:${fact.side}:${fact.kind}:${fact.key}`,
    marketId: fact.marketId,
    marketTitle: fact.marketTitle,
    side: fact.side,
    people: fact.people,
    headline: told.headline,
    body: told.body,
    strength: Math.min(STANDING_INTEL.receiptCeiling, fact.strength),
    motif: `standing:${fact.kind}:${fact.side}`,
  };
}

/**
 * Every standing story one (market, side) can support — intelligence first,
 * then the receipts underneath it. The caller ranks them against everything
 * else in the feed; nothing here reserves a slot for any of them.
 */
export function buildStandingStories(ev: StandingEvidence): StandingStoryRow[] {
  const intel = findStandingIntelligence(ev);
  const receipts = findStandingFacts({
    marketId: ev.marketId,
    marketTitle: ev.marketTitle,
    side: ev.side,
    holders: ev.holders,
    marketAgeDays: ev.marketAgeDays ?? null,
  }).map(toReceipt);
  return [...intel, ...receipts];
}
