/**
 * CONVICTION EVENT GRAMMAR — the feed's story engine.
 *
 * The feed does not report transactions. It reports what happened to somebody's
 * belief. A transaction type ("SELL") is not a story; "a believer of 43 days
 * gave up" is. So nothing here is keyed on BUY/SELL. An event is described in
 * four parts and the sentence is generated from them:
 *
 *   ACTION   what they did to their position  (enter / add / reduce / exit / flip)
 *   ACTOR    who, and what they are to you    (name, relationship)
 *   CONTEXT  everything that makes it matter  (days held, rank, size, what's left)
 *   →        classify() names the human event, tell() writes the sentence
 *
 * Two things fall out of this that the old shape could not express:
 *
 *   • The SAME action becomes a different story depending on context. An exit is
 *     "left", or "gave up after 43 days", or "the last believer walked" — the
 *     action is identical, the meaning is not.
 *   • Adding context can only ever make the language stronger, never invent it.
 *     Every context field is optional and every sentence degrades honestly when
 *     a field is missing (see `tell`). Weak data, weak claim.
 *
 * The event families, and what they mean:
 *
 *   COMMITMENT  first_believer · doubled_down · big_backing · biggest_believer
 *   DOUBT       trimmed · exited · long_held_exit · big_exit · last_believer_left
 *   REVERSAL    changed_mind
 *   SOCIAL      network_entered · network_left   (side-blind, always)
 *   MOMENTUM    surging · milestone · new_market · market_signal
 *
 * PRIVACY, unchanged and enforced by tests: a member of the viewer's network is
 * never shown taking a side. Their row says they moved, never which way.
 */
import type { BeatTone, LiveCategory, LiveStory, NetworkLabel, Side } from "@/domain/story";

/** What someone did to their position. Never a transaction type. */
export type ConvictionAction =
  | "enter"
  | "add"
  | "reduce"
  | "exit"
  | "flip"
  | "round_trip"
  /** One wallet acting across many markets at once, in one direction. */
  | "sweep_in"
  | "sweep_out"
  | "open_market"
  | "milestone"
  | "surge";

/** The human event — what the feed is actually reporting. */
export type ConvictionEventType =
  // Commitment
  | "swept_out"
  | "swept_in"
  | "first_believer"
  | "doubled_down"
  | "big_backing"
  | "joined"
  // Doubt
  | "trimmed"
  | "long_held_exit"
  | "biggest_believer_left"
  | "last_believer_left"
  | "big_exit"
  | "left"
  | "round_trip"
  // Reversal
  | "changed_mind"
  // Social
  | "network_entered"
  | "network_left"
  // Momentum
  | "surging"
  | "milestone"
  | "new_market";

export interface ConvictionContext {
  /** Money involved. Supporting detail — never the subject of a sentence. */
  amountUsd?: number | null;
  /** How long they had held this side before this move. */
  daysHeld?: number | null;
  /**
   * True when `daysHeld` is a LOWER BOUND rather than a measurement — the
   * belief predates the index, so its real start is unknown. Set from the
   * timestamp itself (src/domain/tenure#firstBackedIsFloor) by whoever reads
   * `first_backed_at`; the sentence then claims "43+ days" instead of "43".
   */
  tenureIsFloor?: boolean | null;
  /** They already held this side before this move (so a buy is an ADD). */
  heldBefore?: boolean | null;
  /** Believers left on this side AFTER the move. 0 → the side just emptied. */
  sideBelieversAfter?: number | null;
  /** Their rank by position size on this side. 1 = the biggest believer. */
  rank?: number | null;
  /** How many distinct people this row represents. */
  peopleCount?: number | null;
  /** Distinct markets one person moved in at once — the sweep's whole story. */
  marketCount?: number | null;
  /** The question, for a market that just opened. */
  question?: string | null;
  /** The believer count a milestone crossed. */
  threshold?: number | null;
}

export interface ConvictionEvent {
  action: ConvictionAction;
  side: Side | null;
  actor?: { name: string | null; relationship: NetworkLabel | null } | null;
  context?: ConvictionContext;
}

/**
 * Thresholds. Centralized so "long-held" and "big" mean one thing everywhere,
 * and so the words can be re-tuned without hunting through sentences.
 */
export const CONVICTION_EVENT = {
  /** Held this long and leaving is a story about giving up, not about selling. */
  longHeldDays: 30,
  /** Money large enough that the size IS the news. */
  bigUsd: 1_000,
  /** Ranks that earn "biggest believer" language. */
  topRank: 1,
} as const;

const n = (v: number | null | undefined): number =>
  v == null || !Number.isFinite(Number(v)) ? 0 : Number(v);

const has = (v: number | null | undefined): v is number => v != null && Number.isFinite(Number(v));

/**
 * Name the human event. Ordered by how much it deserves a reader's attention:
 * the rarest, most consequential meaning wins. A network member is always a
 * social event first — belonging outranks mechanics.
 */
export function classifyConvictionEvent(e: ConvictionEvent): ConvictionEventType {
  const c = e.context ?? {};

  if (e.action === "open_market") return "new_market";
  if (e.action === "milestone") return "milestone";
  if (e.action === "surge") return "surging";
  if (e.action === "round_trip") return "round_trip";

  // Someone you're connected to moved. That is the headline, whatever they did.
  const rel = e.actor?.relationship ?? null;
  if (rel) return e.action === "exit" || e.action === "reduce" ? "network_left" : "network_entered";

  if (e.action === "sweep_out") return "swept_out";
  if (e.action === "sweep_in") return "swept_in";
  if (e.action === "flip") return "changed_mind";

  if (e.action === "exit") {
    // A side that just emptied is the strongest exit story there is.
    if (has(c.sideBelieversAfter) && n(c.sideBelieversAfter) === 0) return "last_believer_left";
    if (has(c.rank) && n(c.rank) <= CONVICTION_EVENT.topRank) return "biggest_believer_left";
    if (n(c.daysHeld) >= CONVICTION_EVENT.longHeldDays) return "long_held_exit";
    if (n(c.amountUsd) >= CONVICTION_EVENT.bigUsd) return "big_exit";
    return "left";
  }

  if (e.action === "reduce") return "trimmed";

  if (e.action === "add") return "doubled_down";

  // enter
  if (has(c.sideBelieversAfter) && n(c.sideBelieversAfter) === 1) return "first_believer";
  if (n(c.amountUsd) >= CONVICTION_EVENT.bigUsd) return "big_backing";
  return "joined";
}

/** The kicker for each event — 2–3 words, never a sentence. */
const KICKER: Record<ConvictionEventType, string> = {
  swept_out: "CLEARING OUT",
  swept_in: "GOING BROAD",
  first_believer: "FIRST BELIEVER",
  doubled_down: "DOUBLED DOWN",
  big_backing: "BACKED",
  joined: "NEW BELIEVER",
  trimmed: "SOLD SOME",
  long_held_exit: "LOST CONVICTION",
  biggest_believer_left: "BIGGEST BELIEVER LEFT",
  last_believer_left: "LAST BELIEVER LEFT",
  big_exit: "BIG EXIT",
  left: "BELIEVER LEFT",
  round_trip: "IN AND OUT",
  changed_mind: "CHANGED THEIR MIND",
  network_entered: "",
  network_left: "",
  surging: "SURGING",
  milestone: "MILESTONE",
  new_market: "NEW MARKET",
};

const REL_KICKER: Record<NetworkLabel, string> = {
  twin: "YOUR TWIN",
  tribe: "YOUR TRIBE",
  opp: "YOUR RIVAL",
  inverse: "YOUR OPP",
};

/** How to name someone in your network whose identity we don't have. */
const REL_WHO: Record<NetworkLabel, string> = {
  twin: "Your closest match",
  tribe: "Someone in your Tribe",
  opp: "Your strongest rival",
  inverse: "Someone who mirrors you",
};

const CATEGORY: Record<ConvictionEventType, LiveCategory> = {
  swept_out: "capital_out",
  swept_in: "capital_in",
  first_believer: "growing",
  doubled_down: "capital_in",
  big_backing: "capital_in",
  joined: "growing",
  trimmed: "shrinking",
  long_held_exit: "shrinking",
  biggest_believer_left: "capital_out",
  last_believer_left: "shrinking",
  big_exit: "capital_out",
  left: "shrinking",
  round_trip: "momentum",
  changed_mind: "momentum",
  network_entered: "twin",
  network_left: "twin",
  surging: "momentum",
  milestone: "milestone",
  new_market: "fresh_market",
};

const money = (v: number): string =>
  "$" +
  (v >= 1000
    ? v.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : v.toLocaleString("en-US", { maximumFractionDigits: v < 10 ? 2 : 0 }));

/**
 * "43 days" / "a day" / "3 months" — how long they believed it.
 *
 * `floor` marks a tenure the index cannot fully evidence (src/domain/tenure):
 * the belief was already there when we started looking, so the number is a
 * lower bound and the sentence says so. "43+ days" is a smaller claim than
 * "43 days", and the smaller claim is the true one.
 */
export function heldFor(days: number, floor = false): string {
  const d = Math.round(days);
  if (d <= 1) return floor ? "at least a day" : "a day";
  if (d < 60) return `${d}${floor ? "+" : ""} days`;
  const months = Math.round(d / 30);
  if (months >= 12) return floor ? "at least a year" : "over a year";
  return `${months}${floor ? "+" : ""} months`;
}

const toneFor = (side: Side | null, negative: boolean): BeatTone =>
  side == null ? "neutral" : side === "YES" ? (negative ? "no" : "yes") : negative ? "yes" : "no";

/**
 * ONE supporting clause, never two. A sentence carrying its size AND its tenure
 * AND its rank stops being a sentence and becomes a record. Pick the single most
 * interesting fact the headline has not already used.
 */
function clause(type: ConvictionEventType, c: ConvictionContext): string {
  const days = n(c.daysHeld);
  const floor = c.tenureIsFloor === true;
  const amt = n(c.amountUsd);
  switch (type) {
    case "long_held_exit":
    case "changed_mind":
      // Tenure IS the story here — the kicker already implies it, the sentence proves it.
      return days >= 1 ? ` after ${heldFor(days, floor)}` : "";
    case "doubled_down":
    case "big_backing":
    case "big_exit":
    case "biggest_believer_left":
      return amt > 0 ? ` with ${money(amt)}` : "";
    default:
      // Everyday moves earn a clause only when the number is genuinely notable.
      if (amt >= CONVICTION_EVENT.bigUsd) return ` with ${money(amt)}`;
      if (days >= CONVICTION_EVENT.longHeldDays) return ` after ${heldFor(days, floor)}`;
      return "";
  }
}

/**
 * Write the row. `headline` is the kicker, `body` is the human sentence, and
 * `attribution` carries ONLY what the sentence could not — how big the side is
 * now. Null the moment it would repeat something already said.
 */
export function tellConvictionStory(e: ConvictionEvent): LiveStory {
  const type = classifyConvictionEvent(e);
  const c = e.context ?? {};
  const side = e.side;
  const s = side ?? "";
  const rel = e.actor?.relationship ?? null;
  const name = e.actor?.name ?? null;
  const people = Math.max(1, n(c.peopleCount) || 1);

  // ── A market opened. The question is the whole story. ──
  if (type === "new_market") {
    return {
      category: "fresh_market",
      headline: KICKER.new_market,
      body: c.question?.trim() || "A new question opened.",
      attribution: name ? `${name} opened it.` : null,
      tone: "neutral",
      personal: false,
    };
  }

  if (type === "milestone") {
    const t = n(c.threshold).toLocaleString("en-US");
    return {
      category: "milestone",
      headline: KICKER.milestone,
      body: side ? `${s} reached ${t} believers.` : `${t} people back this question.`,
      attribution: null,
      tone: toneFor(side, false),
      personal: false,
    };
  }

  if (type === "surging") {
    return {
      category: "momentum",
      headline: KICKER.surging,
      body: side ? `Believers in ${s} doubled today.` : "Believers doubled today.",
      attribution: null,
      tone: toneFor(side, false),
      personal: false,
    };
  }

  // ── Someone in your network. Side-blind, always: the kicker says who they are
  //    to you, the sentence says what they did, and neither says which way. ──
  if (rel) {
    const who = name ?? REL_WHO[rel];
    const days = n(c.daysHeld);
    const leaving = type === "network_left";
    // Tenure is safe to state — it reveals commitment, not direction.
    const tail =
      leaving && days >= CONVICTION_EVENT.longHeldDays
        ? ` after ${heldFor(days, c.tenureIsFloor === true)}`
        : "";
    return {
      category: rel,
      headline: REL_KICKER[rel],
      body: `${who} ${leaving ? "stepped back" : "entered"}${tail}.`,
      attribution: null,
      tone: "neutral",
      personal: true,
    };
  }

  const who = name ?? (people > 1 ? `${people} people` : "Someone");
  const negative =
    type === "trimmed" ||
    type === "left" ||
    type === "big_exit" ||
    type === "long_held_exit" ||
    type === "biggest_believer_left" ||
    type === "last_believer_left";
  const remaining = has(c.sideBelieversAfter) ? n(c.sideBelieversAfter) : null;
  /** The scale line — the one thing a behaviour sentence cannot carry. */
  const scale =
    remaining == null || remaining === 0
      ? null
      : `${remaining.toLocaleString("en-US")} believer${remaining === 1 ? "" : "s"} now.`;

  /**
   * SIDE-FREE ALTERNATES. This module's own rule is that a sentence degrades
   * honestly when a field is missing — but every behaviour line below used to
   * interpolate the side unconditionally, so an event stored without one
   * rendered as "Lamello flipped to ." in production. A missing side now costs
   * the sentence a detail, never its grammar.
   */
  const tail = clause(type, c);
  const markets = n(c.marketCount);
  let body: string;
  switch (type) {
    // A SWEEP is about a person and a direction, across markets — it has no
    // side, and the market count IS the story. One person clearing out their
    // whole book is drama; the same fact as fifteen rows is a log file.
    case "swept_out":
      body = `${who} pulled out of ${markets} markets${tail}.`;
      break;
    case "swept_in":
      body = `${who} backed ${markets} markets at once${tail}.`;
      break;
    case "changed_mind":
      body = side ? `${who} flipped to ${s}${tail}.` : `${who} changed their mind${tail}.`;
      break;
    case "round_trip":
      body = side
        ? `${who} backed ${s} and left the same day.`
        : `${who} came and went the same day.`;
      break;
    case "first_believer":
      body = side ? `${who} is the first to back ${s}.` : `${who} is the first one here.`;
      break;
    case "doubled_down":
      body = side ? `${who} added to ${s}${tail}.` : `${who} doubled down${tail}.`;
      break;
    case "big_backing":
      body = side ? `${who} backed ${s}${tail}.` : `${who} took a side${tail}.`;
      break;
    case "trimmed":
      body = side ? `${who} sold some of ${s}${tail}.` : `${who} sold some${tail}.`;
      break;
    case "long_held_exit":
      body = side ? `${who} gave up on ${s}${tail}.` : `${who} gave up${tail}.`;
      break;
    case "biggest_believer_left":
      body = side
        ? `The biggest believer in ${s} walked${tail}.`
        : `The biggest believer walked${tail}.`;
      break;
    case "last_believer_left":
      body = side ? `${who} was the last one backing ${s}.` : `${who} was the last one left.`;
      break;
    case "big_exit":
      body = side ? `${who} pulled out of ${s}${tail}.` : `${who} pulled out${tail}.`;
      break;
    case "left":
      body = side ? `${who} left ${s}${tail}.` : `${who} left${tail}.`;
      break;
    default:
      body = side ? `${who} joined ${s}${tail}.` : `${who} took a side${tail}.`;
  }

  return {
    category: CATEGORY[type],
    headline: KICKER[type],
    body,
    // "N believers now" is noise next to "the last one left" or "the first to back".
    attribution:
      type === "last_believer_left" || type === "first_believer" || type === "round_trip"
        ? null
        : scale,
    tone: toneFor(side, negative),
    personal: false,
  };
}
