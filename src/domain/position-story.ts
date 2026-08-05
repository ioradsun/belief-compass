/**
 * Position story — a backed belief as a living conviction, not a portfolio line.
 *
 * The Positions screen used to answer "how much money do I have?". This module
 * makes each card answer the only question that pulls you back in: "which of my
 * convictions has a story worth following today?" For one held side it derives:
 *
 *   • a PERSONAL pulse — the current state of THIS conviction (Accelerating,
 *     Growing, Cooling, Mixed, Capital-led, Quiet). Never the market-wide pulse
 *     the center shows.
 *   • exactly ONE dynamic story, chosen by how much it deserves attention:
 *     Twin → Tribe → Opp → milestone → believer surge → capital → pulse → the
 *     everyday (early / gain / quiet).
 *   • an urgency rank so the most alive convictions rise to the top of the list.
 *
 * ZERO IO, pure, fully testable. Money arrives already formatted by the caller so
 * the domain stays unit-agnostic. It never reveals a network member's side — a
 * Twin/Tribe/Opp "entered this market", never "backed YES".
 */

export type Side = "YES" | "NO";

export type PositionPulse =
  "Accelerating" | "Growing" | "Cooling" | "Mixed Momentum" | "Capital-led" | "Quiet";

export type PulseTone = "up" | "down" | "neutral" | "muted";

export const PULSE_TONE: Record<PositionPulse, PulseTone> = {
  Accelerating: "up",
  Growing: "up",
  Cooling: "down",
  "Mixed Momentum": "neutral",
  "Capital-led": "neutral",
  Quiet: "muted",
};

/** The one story a card tells, in priority order (also its urgency rank). */
export type StoryKind =
  | "twin"
  | "tribe"
  | "opp"
  | "milestone"
  | "believer_surge"
  | "capital"
  | "momentum"
  | "believers"
  | "gain"
  | "early"
  | "quiet";

export const STORY_RANK: Record<StoryKind, number> = {
  twin: 100,
  tribe: 90,
  opp: 80,
  milestone: 70,
  believer_surge: 60,
  capital: 50,
  momentum: 40,
  believers: 30,
  gain: 20,
  early: 15,
  quiet: 0,
};

export interface PositionStory {
  kind: StoryKind;
  /** The one-sentence reason to open the market — the card's footer. */
  headline: string;
  /** Optional supporting line ("35 people now back YES."). */
  body?: string;
  tone: PulseTone;
}

export interface PositionStoryInput {
  side: Side;
  /** Believers on the held side, now. */
  believers: number | null;
  /** New believers on the held side today. */
  newToday: number | null;
  /** worth − cost, in the caller's currency (already computed). */
  gainUsd: number | null;
  /** The held side's price move over the window, in %. Momentum only, not P&L. */
  chgPct: number | null;
  /** Network activity on THIS market (side-blind): did they just enter? */
  net?: { twin?: boolean; tribe?: boolean; opp?: boolean };
  /** A believer milestone this market just crossed (10/25/50/…), or null. */
  milestone?: number | null;
}

/** New believers at/above this count reads as a surge, not a trickle. */
export const BELIEVER_SURGE = 3;
/** Below this many believers a side is still forming — "still early". */
export const EARLY_BELIEVERS = 10;
/** A side price move this large (|%|) counts as real momentum for the pulse. */
export const PULSE_MOVE_PCT = 1;

/**
 * The conviction's personal pulse. People lead, so new believers dominate; price
 * only speaks when believers are quiet (money moving without new people = capital-
 * led) or when it contradicts them (people up, price down = mixed).
 */
export function positionPulse(
  input: Pick<PositionStoryInput, "newToday" | "chgPct">,
): PositionPulse {
  const n = input.newToday ?? 0;
  const c = input.chgPct ?? 0;
  if (n >= 1 && c <= -PULSE_MOVE_PCT) return "Mixed Momentum";
  if (n >= BELIEVER_SURGE) return "Accelerating";
  if (n >= 1) return "Growing";
  if (c >= PULSE_MOVE_PCT) return "Capital-led";
  if (c <= -PULSE_MOVE_PCT) return "Cooling";
  return "Quiet";
}

/**
 * The one dynamic story for a card, chosen by priority. Every branch is plain
 * language — the money on the card speaks for itself, so no branch spends the
 * sentence restating a gain. `_money` is kept for callers (and future copy that
 * needs a currency) and deliberately unused here.
 */
export function positionStory(
  input: PositionStoryInput,
  _money?: (n: number) => string,
): PositionStory {
  const { side, believers, gainUsd } = input;
  const n = input.newToday ?? 0;
  const net = input.net ?? {};

  // 1–3 — your people arrived. Side-blind: never reveal THEIR side.
  if (net.twin)
    return { kind: "twin", headline: "Your Conviction Twin just entered this market.", tone: "up" };
  if (net.tribe)
    return {
      kind: "tribe",
      headline: "Your Tribe is becoming active here.",
      body: "Someone you move with just entered.",
      tone: "up",
    };
  if (net.opp)
    return { kind: "opp", headline: "Your strongest Opp entered this market.", tone: "neutral" };

  // 4 — the market hit a milestone.
  if (input.milestone != null)
    return {
      kind: "milestone",
      headline: `This market just reached ${input.milestone.toLocaleString("en-US")} believers.`,
      tone: "up",
    };

  // 5 — a surge of believers onto the held side. Say who joined and how many
  // stand there now in ONE sentence: the card carries no separate believer row.
  if (n >= BELIEVER_SURGE)
    return {
      kind: "believer_surge",
      headline: `${n} people joined ${side} today.`,
      body:
        believers != null
          ? `${believers.toLocaleString("en-US")} now back ${side}.`
          : undefined,
      tone: "up",
    };

  // 6–7 — the state of the side, in plain words. Never a classification the
  // reader has to decode ("Capital-led", "Accelerating", "Momentum"): say what
  // people and money actually did.
  const pulse = positionPulse(input);
  if (pulse === "Capital-led")
    return {
      kind: "capital",
      headline: `Money is moving into ${side} without new believers.`,
      tone: "neutral",
    };
  if (pulse === "Accelerating")
    return { kind: "momentum", headline: `${side} is getting stronger.`, tone: "up" };
  if (pulse === "Cooling")
    return { kind: "momentum", headline: `${side} is losing ground.`, tone: "down" };
  if (pulse === "Mixed Momentum")
    return {
      kind: "momentum",
      headline: `People are joining ${side}, but its price slipped.`,
      tone: "neutral",
    };

  // 8 — the everyday: one person joined, an early market, or nothing moved.
  if (n >= 1)
    return {
      kind: "believers",
      headline:
        believers != null
          ? `${n} joined ${side} today — ${believers.toLocaleString("en-US")} now back it.`
          : `${n} ${n === 1 ? "person" : "people"} joined ${side} today.`,
      tone: "up",
    };
  if (believers != null && believers < EARLY_BELIEVERS)
    return {
      kind: "early",
      headline:
        believers === 1
          ? `You are the only believer on ${side} so far.`
          : `Only ${believers.toLocaleString("en-US")} people back ${side} so far.`,
      tone: "muted",
    };
  if (believers != null && believers > 0)
    return {
      kind: "quiet",
      headline: `Nothing changed today — ${believers.toLocaleString("en-US")} still back ${side}.`,
      tone: "muted",
    };
  return { kind: "quiet", headline: "Nothing has changed today.", tone: "muted" };
}


export interface PositionSignal {
  pulse: PositionPulse;
  pulseTone: PulseTone;
  story: PositionStory;
  /** Higher = more deserving of the top of the list. */
  urgency: number;
}

/** Everything a card needs to render + its rank for sorting by "what's alive". */
export function positionSignal(
  input: PositionStoryInput,
  money: (n: number) => string,
): PositionSignal {
  const pulse = positionPulse(input);
  const story = positionStory(input, money);
  return { pulse, pulseTone: PULSE_TONE[pulse], story, urgency: STORY_RANK[story.kind] };
}
