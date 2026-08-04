/**
 * CONVICTION COHORTS — the people behind a belief, told as one story.
 *
 * Everything else in the feed reports a MOVE. This reports a STATE: who is still
 * here, and how long they have been. That is what makes a quiet market feel
 * inhabited rather than abandoned, and it is the only honest way to fill a lull —
 * no fabricated movement, just belief that was already there, finally said out
 * loud.
 *
 *     HOLDING STRONG
 *     Jon, Kate, and 12 others reached 30 days.
 *     [Jon] [Kate] [Maya] [+12]
 *
 * It is NOT a second feed. It produces the same normalized story every other
 * surface renders, plus the `people` who are in it, and the existing renderers
 * decide how much context to strip.
 *
 * FOUR DISCIPLINES, all tested:
 *
 *   1. MILESTONES, NOT TICKING. A ladder of durations people actually think in
 *      (7 · 30 · 60 · 90 · 180 · 365). "Jon reached 30 days" is a story; "Jon has
 *      now held for 14 days" three days running is spam. A cohort is only
 *      reported in the window it CROSSED its rung.
 *   2. THE GROUP OUTRANKS THE INDIVIDUAL. Three people crossing 30 days is one
 *      story, never three. A solo milestone is emitted only when nobody else
 *      crossed with them.
 *   3. ONE FACT, ONE FINGERPRINT. The identity is (market, side, rung) — so the
 *      same cohort can never be told twice by two surfaces, and dedup upstream
 *      (src/domain/transition-emit) works on it unchanged.
 *   4. RECOGNITION IS EARNED. Dust positions don't buy a face. A holder must
 *      clear a real position floor to be counted, which is also what stops
 *      milestone farming with a spray of tiny wallets.
 *
 * CONTEXT-AWARE, ONE STORY. `renderCohort` takes the surface: the app-wide feed
 * has no idea which market you're looking at, so it says so; a YES panel already
 * says YES at the top of the column, so the sentence doesn't. Same event, same
 * meaning, less repetition the deeper you are.
 *
 * SAFETY: this celebrates persistence. It never frames leaving as failure, never
 * implies anyone should stay, and never claims a quality ("steadfast",
 * "diamond hands") the data cannot evidence. Duration is a fact; character is not.
 *
 * ZERO IO, pure, fully testable.
 */
import { NETWORK_STRENGTH, type NetworkLabel, type Side } from "@/domain/story";

/** Durations people actually think in. Anything between rungs is not a story. */
export const HOLDING_RUNGS = [7, 30, 60, 90, 180, 365] as const;
export type HoldingRung = (typeof HOLDING_RUNGS)[number];

export const COHORT = {
  /** Below this a position is dust — it earns no face and no mention. */
  minPositionUsd: 5,
  /** Faces shown before the rest become "+N". Enough to recognise, not to crowd. */
  maxFaces: 3,
  /** Under this many people it is an individual story, not a cohort. */
  groupMin: 2,
  /**
   * A solo milestone needs a longer belief to be worth a row on its own — one
   * person hitting the first rung is not news, one person at 90 days is.
   */
  soloMinRung: 30,
} as const;

/**
 * The minimum needed to show someone as a face and open their profile. Any
 * group story — a holding cohort, a discovery moment, an aggregated burst — can
 * be rendered from this, so the face stack never asks a caller to fabricate a
 * position size it does not have.
 */
export interface StackPerson {
  wallet: string;
  name: string | null;
  avatarUrl: string | null;
  /** Their relationship to the VIEWER, when there is one. */
  relationship?: NetworkLabel | null;
}

/** One person still backing a side, with what we know about them. */
export interface CohortHolder extends StackPerson {
  /** How long they have continuously backed this side. */
  daysHeld: number;
  /** Current value of the position, in USD. Gates dust; never displayed raw. */
  positionUsd: number;
}

export interface CohortInput {
  side: Side;
  holders: CohortHolder[];
  /**
   * Days since this market opened. Lets a cohort be recognised as founding
   * believers rather than merely long-held. Omitted → never claimed.
   */
  marketAgeDays?: number | null;
  /** Total believers on this side, for share-of-side significance. */
  sideBelievers?: number | null;
  /** How long the reporting window is (days). A rung counts as CROSSED when
   *  the holder passed it inside this window — that is what stops daily repeats. */
  windowDays?: number;
}

export type CohortKind = "holding" | "founding" | "tribe_holding";

export interface ConvictionCohort {
  kind: CohortKind;
  side: Side;
  rung: HoldingRung;
  /** Everyone in the cohort, most notable first. */
  people: CohortHolder[];
  /** Stable identity — (side, kind, rung). Dedup and cooldowns key on this. */
  fingerprint: string;
  /** 0..1. Rarity of the rung × how much of the side it is × who they are to you. */
  significance: number;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The highest rung a holder has passed. Null below the first one. */
export function rungFor(daysHeld: number): HoldingRung | null {
  let hit: HoldingRung | null = null;
  for (const r of HOLDING_RUNGS) if (daysHeld >= r) hit = r;
  return hit;
}

/**
 * Did they cross this rung inside the reporting window? A holder at 45 days in
 * a 1-day window crossed nothing — they crossed 30 a fortnight ago and that
 * story has already been told. This is the whole anti-repeat mechanism.
 */
function crossedInWindow(daysHeld: number, rung: HoldingRung, windowDays: number): boolean {
  return daysHeld >= rung && daysHeld - windowDays < rung;
}

/** Rarer rungs are better stories. 7 days is common; a year is not. */
function rungWeight(rung: HoldingRung): number {
  const i = HOLDING_RUNGS.indexOf(rung);
  return (i + 1) / HOLDING_RUNGS.length;
}

/** The app's one relationship strength scale — never a local copy of it. */
const REL_WEIGHT = NETWORK_STRENGTH;

/**
 * Who leads the stack. People the viewer has a relationship with come first —
 * a face you recognise is the entire point — then the longest-held, then the
 * largest. Deterministic, so the same cohort always shows the same faces.
 */
function rank(a: CohortHolder, b: CohortHolder): number {
  const rel = (h: CohortHolder) => (h.relationship ? REL_WEIGHT[h.relationship] : 0);
  return (
    rel(b) - rel(a) ||
    b.daysHeld - a.daysHeld ||
    b.positionUsd - a.positionUsd ||
    a.wallet.localeCompare(b.wallet)
  );
}

/**
 * Find the cohorts worth reporting for one side. Returns at most one per rung,
 * strongest first — the caller takes what its pacing allows.
 */
export function findCohorts(input: CohortInput): ConvictionCohort[] {
  const windowDays = input.windowDays ?? 1;
  const eligible = input.holders.filter(
    (h) => h.positionUsd >= COHORT.minPositionUsd && Number.isFinite(h.daysHeld) && h.daysHeld > 0,
  );
  if (eligible.length === 0) return [];

  const out: ConvictionCohort[] = [];
  for (const rung of HOLDING_RUNGS) {
    const crossed = eligible.filter((h) => crossedInWindow(h.daysHeld, rung, windowDays));
    if (crossed.length === 0) continue;
    // A lone believer needs a longer belief to earn a row by themselves.
    if (crossed.length < COHORT.groupMin && rung < COHORT.soloMinRung) continue;

    const people = [...crossed].sort(rank);
    // FOUNDING: everyone here has been present essentially since the market
    // opened. Only claimable when we were told how old the market is.
    const age = input.marketAgeDays ?? null;
    const founding =
      age != null &&
      age > rung &&
      people.every((h) => h.daysHeld >= age * 0.9) &&
      people.length > 1;
    const tribe = people.filter((h) => h.relationship === "tribe" || h.relationship === "twin");
    const kind: CohortKind =
      tribe.length >= COHORT.groupMin ? "tribe_holding" : founding ? "founding" : "holding";

    const share =
      input.sideBelievers && input.sideBelievers > 0
        ? clamp01(people.length / input.sideBelievers)
        : 0;
    const relBoost = people.reduce(
      (m, h) => Math.max(m, h.relationship ? REL_WEIGHT[h.relationship] : 0),
      0,
    );
    const significance = clamp01(
      0.45 * rungWeight(rung) + 0.25 * share + 0.3 * relBoost + (people.length > 1 ? 0.1 : 0),
    );

    out.push({
      kind,
      side: input.side,
      rung,
      people,
      fingerprint: `cohort:${input.side}:${kind}:${rung}`,
      significance,
    });
  }
  return out.sort((a, b) => b.significance - a.significance);
}

/** Where a story is being read. Deeper surfaces already supply their own context. */
export type FeedSurface =
  /** The app-wide feed. Knows nothing — needs the market and the side named. */
  | "app"
  /** Inside one market's YES or NO panel. The column already says both. */
  | "panel";

export interface CohortStory {
  headline: string;
  body: string;
  /** The market question — only ever set for the app-wide surface. */
  marketTitle?: string | null;
  people: CohortHolder[];
  fingerprint: string;
}

const KIND_HEADLINE: Record<CohortKind, string> = {
  holding: "HOLDING STRONG",
  founding: "FOUNDING BELIEVERS",
  tribe_holding: "YOUR PEOPLE ARE HERE",
};

/** "30 days" / "3 months" / "a year" — the rung in the words people use. */
export function rungText(rung: HoldingRung): string {
  if (rung < 60) return `${rung} days`;
  if (rung === 365) return "a year";
  return `${Math.round(rung / 30)} months`;
}

/**
 * Name the people. Up to two by name, then a count — "Jon, Kate, and 12 others".
 * Anyone we can't name is folded into the count rather than shown as a hex
 * address, so a row never leaks plumbing.
 */
export function nameList(people: CohortHolder[]): string {
  const named = people.filter((p) => p.name).map((p) => p.name as string);
  const total = people.length;
  if (named.length === 0) return `${total} ${total === 1 ? "believer" : "believers"}`;
  if (total === 1) return named[0];
  const lead = named.slice(0, 2);
  const rest = total - lead.length;
  if (rest <= 0) return lead.length === 2 ? `${lead[0]} and ${lead[1]}` : lead[0];
  return `${lead.join(", ")}, and ${rest} ${rest === 1 ? "other" : "others"}`;
}

/**
 * Render one cohort for one surface. The STORY is identical either way — only
 * context the surface already provides is removed. There is deliberately no
 * second copy path: a panel never says something the app-wide feed wouldn't.
 */
export function renderCohort(
  cohort: ConvictionCohort,
  surface: FeedSurface,
  marketTitle?: string | null,
): CohortStory {
  const who = nameList(cohort.people);
  const dur = rungText(cohort.rung);
  const app = surface === "app";

  let body: string;
  switch (cohort.kind) {
    case "founding":
      body = app
        ? `${who} have backed ${cohort.side} since the market opened.`
        : `${who} have been here since the market opened.`;
      break;
    case "tribe_holding":
      body = app
        ? `${who} from your Tribe reached ${dur} on ${cohort.side}.`
        : `${who} from your Tribe reached ${dur}.`;
      break;
    default:
      body = app ? `${who} have backed ${cohort.side} for ${dur}.` : `${who} reached ${dur}.`;
  }

  return {
    headline: KIND_HEADLINE[cohort.kind],
    body,
    // The panel sits inside the market; repeating its question is noise.
    marketTitle: app ? (marketTitle ?? null) : null,
    people: cohort.people,
    fingerprint: cohort.fingerprint,
  };
}

/**
 * How many faces to show, and how many are left over. Kept here rather than in
 * the component so the rule is testable and identical on every surface.
 */
export function faceSplit<T>(people: T[]): { faces: T[]; overflow: number } {
  const faces = people.slice(0, COHORT.maxFaces);
  return { faces, overflow: Math.max(0, people.length - faces.length) };
}
