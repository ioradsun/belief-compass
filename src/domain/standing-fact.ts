/**
 * STANDING FACTS — who is still here, said during the silence.
 *
 * Everything else in the feed reports a CHANGE. This reports a CONTINUITY, and
 * that difference is the whole reason it exists: an event is only true for a
 * moment, so a feed built entirely from events has nothing to say the moment
 * nothing happens. On a platform averaging one trade every eleven minutes, that
 * is most of the time.
 *
 *     STILL HERE
 *     Kate has backed YES for 11+ days.
 *     [Kate]
 *
 * NOT EVENTS. A standing fact has no `occurredAt` and no expiry. "Kate has held
 * this belief for 43 days" is equally true now, tomorrow, and next Tuesday —
 * treating it as an event with a maximum age manufactures the staleness it then
 * has to manage, and a queue of celebrations drains to empty, which is the dead
 * feed this is meant to prevent. The correct control is a per-reader COOLDOWN:
 * do not say the same thing to the same person too soon.
 *
 * WHY THIS AND NOT MORE MILESTONES. The brief was "you are not alone", and
 * pacing cannot produce that — motion makes a page feel live, but belonging
 * comes from RECOGNITION. You feel less alone in a village of eight people you
 * can name than in a city of ten thousand strangers. So these facts are about
 * PEOPLE recurring, not about achievements unlocking: the same faces, still
 * here, encountered again.
 *
 * FOUR DISCIPLINES:
 *
 *   1. NEVER INVENT. Every fact is derived from a position someone actually
 *      holds. If nobody holds anything, this returns nothing and the tape is
 *      honestly quiet. Silence is a fact; filling it with fiction is not.
 *   2. NEVER OVERCLAIM TENURE. A belief that predates the index has no knowable
 *      start (src/domain/tenure), so it says "11+ days". The floor is carried
 *      in, never guessed here.
 *   3. A NETWORK MEMBER'S SIDE IS SHOWN, like anyone else's. It used to be
 *      withheld, which cost more here than anywhere: a standing fact is scoped
 *      to one market AND SIDE already, so hiding it forced the reader's own
 *      people out of the strongest tenure facts entirely — a Twin who had held
 *      the longest could never be the one still holding. Every position is
 *      public on-chain; the rule bought drama management, not privacy.
 *   4. RECOGNITION OVER SIZE. The ranking leads with the reader's own people.
 *      A stranger's $5,000 position is a bigger number; a Twin still holding is
 *      a better reason to feel accompanied.
 *
 * ZERO IO, pure, fully testable.
 */
import { NETWORK_STRENGTH, type NetworkLabel, type Side } from "@/domain/story";
import type { StackPerson } from "@/domain/conviction-cohort";

export const STANDING = {
  /**
   * Below this a position is dust — it earns no face and no mention.
   *
   * IT WAS FIVE DOLLARS, and that number nearly silenced the one mechanism this
   * module exists to be. Measured across 2,000 live sides, 329 hold both capital
   * and a believer, and at a $5 floor AT MOST 29 of them could produce a fact —
   * realistically about 18, once a side's capital is split among the people on
   * it. Five percent coverage, on the feature whose whole job is to have
   * something true to say when nothing is happening.
   *
   * One dollar is the line the rest of the product already draws between money
   * and dust (METRIC_DISPLAY.capitalUsd.pctValidMinBase), and it quadruples the
   * pool to roughly 77 sides. Below it the curve flattens — $0.25 buys 181 and
   * $0.10 buys 199 — so going lower admits dust for almost no coverage.
   *
   * And the low floor is not a compromise; it is what this module already
   * argues for. "RECOGNITION OVER SIZE" means the dollar threshold exists ONLY
   * to exclude what is not really a position. It was never meant to rank.
   */
  minPositionUsd: 1,
  /** Under this many days, "still here" is not yet a claim worth making. */
  minDays: 3,
  /** People named before the rest become "+N". */
  maxPeople: 3,
  /**
   * How long before the same fact may be said to the same reader again.
   *
   * This is what replaces an expiry. Long enough that the tape never nags, short
   * enough that a small pool still has something to say across a week of quiet
   * days. A fact is identified by its `key`, so a cohort that GROWS becomes a
   * different fact and may speak sooner — which is correct, because it is news.
   */
  cooldownMs: 3 * 86_400_000,
  /**
   * A market a reader keeps meeting the same person in. Below this it is
   * coincidence, not a pattern worth naming.
   */
  minCrossings: 3,
} as const;

export type StandingFactKind =
  /** Someone has held a belief for a long time. The base case. */
  | "still_holding"
  /** They have been here since the market opened. */
  | "founding"
  /** People from the reader's network hold a position here. */
  | "tribe_present"
  /** The reader keeps encountering this person across markets. */
  | "crossed_paths";

/** One person's live position, as this module needs it. */
export interface StandingHolder extends StackPerson {
  /** How long they have continuously held it. */
  daysHeld: number;
  /** True when `daysHeld` is a lower bound — see src/domain/tenure. */
  tenureIsFloor?: boolean;
  /** Current value, USD. Gates dust; never displayed raw. */
  positionUsd: number;
  /** How many markets the reader and this person both hold a belief in. */
  crossings?: number | null;
}

export interface StandingInput {
  marketId: number;
  marketTitle: string;
  side: Side;
  holders: StandingHolder[];
  /** Days since the market opened, for a founding claim. Omitted → never claimed. */
  marketAgeDays?: number | null;
}

export interface StandingFact {
  kind: StandingFactKind;
  marketId: number;
  marketTitle: string;
  /**
   * The side these people hold. Every fact is scoped to one market AND side, so
   * this is always known — it was once documented as nullable for network facts,
   * back when their side was withheld, and the field was set anyway.
   */
  side: Side;
  people: StandingHolder[];
  /**
   * Stable identity for the reader's cooldown. Includes the group size, so a
   * cohort that grows is a genuinely different fact and is allowed to speak.
   */
  key: string;
  /** 0..1. Recognition first, then tenure, then size. Reader-relative. */
  strength: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const isNetwork = (h: StandingHolder) => h.relationship === "twin" || h.relationship === "tribe";

/** Recognition dominates: a Twin still holding beats a stranger's larger bet. */
function recognition(people: StandingHolder[]): number {
  let best = 0;
  for (const p of people) {
    const w = p.relationship ? NETWORK_STRENGTH[p.relationship as NetworkLabel] : 0;
    if (w > best) best = w;
  }
  return best;
}

/** Longer is stronger, flattening out — a year is not ten times a month. */
function tenureWeight(days: number): number {
  return clamp01(Math.log10(Math.max(1, days) + 1) / Math.log10(366));
}

function rank(a: StandingHolder, b: StandingHolder): number {
  const rel = (h: StandingHolder) =>
    h.relationship ? NETWORK_STRENGTH[h.relationship as NetworkLabel] : 0;
  return (
    rel(b) - rel(a) ||
    b.daysHeld - a.daysHeld ||
    b.positionUsd - a.positionUsd ||
    a.wallet.localeCompare(b.wallet)
  );
}

/**
 * Every standing fact this market's side can honestly support, strongest first.
 * The caller takes what its silence allows — usually one.
 */
export function findStandingFacts(input: StandingInput): StandingFact[] {
  const eligible = input.holders.filter(
    (h) =>
      h.positionUsd >= STANDING.minPositionUsd &&
      Number.isFinite(h.daysHeld) &&
      h.daysHeld >= STANDING.minDays,
  );
  if (eligible.length === 0) return [];

  const people = [...eligible].sort(rank);
  const out: StandingFact[] = [];
  const base = `${input.marketId}:${input.side}`;

  // CROSSED PATHS — the strongest "not alone" fact there is, because it is the
  // only one about the reader's own history rather than a market's.
  const recurring = people.filter((h) => (h.crossings ?? 0) >= STANDING.minCrossings);
  for (const h of recurring.slice(0, 1)) {
    out.push({
      kind: "crossed_paths",
      marketId: input.marketId,
      marketTitle: input.marketTitle,
      side: input.side,
      people: [h],
      key: `crossed:${h.wallet}:${h.crossings}`,
      strength: clamp01(0.5 + 0.3 * recognition([h]) + 0.2 * tenureWeight(h.daysHeld)),
    });
  }

  // TRIBE PRESENT — who you know is here, and which way they went.
  const known = people.filter(isNetwork);
  if (known.length > 0) {
    out.push({
      kind: "tribe_present",
      marketId: input.marketId,
      marketTitle: input.marketTitle,
      side: input.side,
      people: known.slice(0, STANDING.maxPeople),
      key: `tribe:${base}:${known.length}`,
      strength: clamp01(0.35 + 0.4 * recognition(known) + 0.1 * Math.min(1, known.length / 3)),
    });
  }

  // FOUNDING — here since the market opened. Only claimable when we were told
  // how old the market is. Network members are no longer held out of this and
  // `still_holding`: they were excluded only to keep their side hidden, which
  // also meant the reader's OWN people never earned the strongest tenure fact
  // in a market they had held longest.
  const open = people;
  const age = input.marketAgeDays ?? null;
  const founders =
    age != null && age >= STANDING.minDays
      ? open.filter((h) => h.daysHeld >= age * 0.9)
      : ([] as StandingHolder[]);
  if (founders.length > 0) {
    out.push({
      kind: "founding",
      marketId: input.marketId,
      marketTitle: input.marketTitle,
      side: input.side,
      people: founders.slice(0, STANDING.maxPeople),
      key: `founding:${base}:${founders.length}`,
      strength: clamp01(
        0.4 + 0.3 * tenureWeight(age ?? 0) + 0.1 * Math.min(1, founders.length / 3),
      ),
    });
  }

  // STILL HOLDING — the base case, and the one that works with no reader at all.
  if (open.length > 0) {
    const lead = open[0];
    out.push({
      kind: "still_holding",
      marketId: input.marketId,
      marketTitle: input.marketTitle,
      side: input.side,
      people: open.slice(0, STANDING.maxPeople),
      key: `holding:${base}:${open.length}:${Math.floor(lead.daysHeld)}`,
      strength: clamp01(
        0.2 + 0.4 * tenureWeight(lead.daysHeld) + 0.1 * Math.min(1, open.length / 3),
      ),
    });
  }

  return out.sort((a, b) => b.strength - a.strength);
}

/**
 * Which facts to draw now. The cooldown is what makes a small pool last: the
 * same truth is not repeated to the same reader inside `cooldownMs`, so a
 * handful of long-held beliefs can carry weeks of quiet days without ever
 * reading as a loop.
 */
/**
 * May this fact be said to this reader now? The single expression of the
 * cooldown rule — the server picks the pool and the client owns the memory of
 * what it has already shown, so both have to ask the same question the same way.
 */
export function isFactFresh(
  key: string,
  saidAt: ReadonlyMap<string, number>,
  nowMs: number,
  cooldownMs: number = STANDING.cooldownMs,
): boolean {
  const last = saidAt.get(key);
  return last == null || nowMs - last >= cooldownMs;
}

export function pickStandingFacts(
  facts: StandingFact[],
  saidAt: ReadonlyMap<string, number>,
  nowMs: number,
  limit: number,
  cooldownMs: number = STANDING.cooldownMs,
): StandingFact[] {
  const fresh = facts.filter((f) => isFactFresh(f.key, saidAt, nowMs, cooldownMs));
  // One fact per market, so a single busy market cannot own every quiet moment.
  const byMarket = new Set<number>();
  const out: StandingFact[] = [];
  for (const f of [...fresh].sort(
    (a, b) => b.strength - a.strength || a.key.localeCompare(b.key),
  )) {
    if (byMarket.has(f.marketId)) continue;
    byMarket.add(f.marketId);
    out.push(f);
    if (out.length >= limit) break;
  }
  return out;
}

export interface StandingStory {
  headline: string;
  body: string;
  people: StandingHolder[];
  key: string;
}

const HEADLINE: Record<StandingFactKind, string> = {
  still_holding: "STILL HERE",
  founding: "HERE SINCE THE START",
  tribe_present: "YOUR PEOPLE ARE HERE",
  crossed_paths: "YOU KEEP MEETING",
};

/** "43+ days" / "11 days" — a duration, honest about what it can prove. */
export function heldText(days: number, floor = false): string {
  const d = Math.max(0, Math.floor(days));
  if (d < 60) return `${d}${floor ? "+" : ""} days`;
  const months = Math.floor(d / 30);
  if (months < 12) return `${months}${floor ? "+" : ""} months`;
  const years = Math.floor(d / 365);
  return years === 1 ? (floor ? "over a year" : "a year") : `${years}${floor ? "+" : ""} years`;
}

/** "Kate", "Kate and Maya", "Kate, Maya, and 4 others". */
export function nameThem(people: StandingHolder[], total = people.length): string {
  const named = people.filter((p) => p.name).map((p) => p.name as string);
  if (named.length === 0) return `${total} ${total === 1 ? "believer" : "believers"}`;
  if (total === 1) return named[0];
  const lead = named.slice(0, 2);
  const rest = total - lead.length;
  if (rest <= 0) return lead.length === 2 ? `${lead[0]} and ${lead[1]}` : lead[0];
  return `${lead.join(", ")}, and ${rest} ${rest === 1 ? "other" : "others"}`;
}

/**
 * Say it. Note what a sentence still does NOT contain: no claim of a quality
 * ("loyal", "diamond hands") the data cannot evidence. Duration is a fact;
 * character is not.
 *
 * The one thing that used to be missing is now here — a network fact names its
 * side. `tribe_present` said "Kate and Maya are here from your network" while
 * holding a `side` field it refused to read, which made the reader's OWN people
 * the only ones in the tape whose beliefs were unreadable.
 */
export function tellStandingFact(fact: StandingFact): StandingStory {
  const who = nameThem(fact.people);
  const lead = fact.people[0];
  const dur = lead ? heldText(lead.daysHeld, lead.tenureIsFloor === true) : "";

  let body: string;
  switch (fact.kind) {
    case "crossed_paths":
      body = `You and ${who} have backed the same ${lead?.crossings} markets.`;
      break;
    case "tribe_present":
      body =
        fact.people.length === 1
          ? `${who} is on ${fact.side} here, ${dur} in.`
          : `${who} are on ${fact.side} here, from your network.`;
      break;
    case "founding":
      body = `${who} ${fact.people.length === 1 ? "has" : "have"} backed ${fact.side} since the market opened.`;
      break;
    default:
      body = `${who} ${fact.people.length === 1 ? "has" : "have"} backed ${fact.side} for ${dur}.`;
  }

  return { headline: HEADLINE[fact.kind], body, people: fact.people, key: fact.key };
}
