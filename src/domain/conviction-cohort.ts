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
 *   3. ONE FACT, ONE FINGERPRINT. The identity is (market, side, rung, CROSSING
 *      DATE) — so the same cohort can never be told twice by two surfaces, and
 *      dedup upstream (src/domain/transition-emit) works on it unchanged. The
 *      date matters: without it a market could report a 30-day cohort exactly
 *      once ever, and every later wave of believers reaching thirty days
 *      collided with the same key and vanished. Two groups, two stories.
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
  /**
   * The most cohorts one emitter run may publish, best first.
   *
   * A duration milestone is driven by the clock, so markets that started
   * together cross together. This platform's index begins at a single instant
   * (see src/domain/tenure), which means ~681 markets share one `first_backed_at`
   * and will cross the 30-day rung on the SAME DAY. Without a cap, that day
   * publishes hundreds of cohort events at once and the feature built to fill
   * quiet markets becomes the loudest thing that ever happened.
   *
   * The cap makes the emitter publish the strongest ones and come back for the
   * rest next run, so a mass crossing drains over hours instead of landing in
   * one batch. It is a PACING rule, not a quality bar — nothing is discarded,
   * only deferred.
   */
  maxPerRun: 12,
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
  /**
   * The clock `daysHeld` was measured against. Supplied so the CROSSING INSTANT
   * can be recovered: `crossedAt = nowMs − (daysHeld − rung) days` is really
   * `firstBackedAt + rung days`, because the same `nowMs` that produced
   * `daysHeld` cancels out. That cancellation is what makes the crossing date
   * stable across cron runs — including runs either side of midnight.
   */
  nowMs?: number;
  /** Which holders count at each rung. See `CohortScan`. Defaults to "crossing". */
  scan?: CohortScan;
}

/**
 * Which holders a rung is allowed to claim.
 *
 *   · "crossing" — only those who passed the rung inside `windowDays`. This is
 *     the daily rule and the entire anti-repeat mechanism: a market with plenty
 *     of long-term holders says nothing on an ordinary day.
 *
 *   · "standing" — those sitting AT their highest rung, whenever they crossed
 *     it. For one-time catch-up over history the emitter never saw. A rung can
 *     only ever be crossed on one specific day, so if nothing was running that
 *     day the moment is lost — and this platform lost every 7-day crossing
 *     exactly that way, all on 2026-07-31, while the emitter was still scoped
 *     to markets that had recently traded.
 *
 * Both derive the SAME crossing date from the same arithmetic, so both produce
 * the same fingerprint for the same fact. A catch-up emission and the daily
 * emission that should have happened are indistinguishable, which is what makes
 * running catch-up safe: the upsert collapses them.
 */
export type CohortScan = "crossing" | "standing";

export type CohortKind = "holding" | "founding" | "tribe_holding";

export interface ConvictionCohort {
  kind: CohortKind;
  side: Side;
  rung: HoldingRung;
  /** Everyone in the cohort, most notable first. */
  people: CohortHolder[];
  /** Stable identity — (side, kind, rung, crossing date). Dedup keys on this. */
  fingerprint: string;
  /**
   * The UTC date this group crossed the rung (YYYY-MM-DD). Part of the stored
   * identity, and the reason a SECOND wave can be told: a market's YES side
   * crossing 30 days in March and again in June are two different facts about
   * two different groups, and keying on (side, kind, rung) alone silenced the
   * second one forever.
   */
  crossedOn: string;
  /** 0..1. Rarity of the rung × how much of the side it is. Viewer-independent. */
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
  const nowMs = input.nowMs ?? Date.now();
  const eligible = input.holders.filter(
    (h) => h.positionUsd >= COHORT.minPositionUsd && Number.isFinite(h.daysHeld) && h.daysHeld > 0,
  );
  if (eligible.length === 0) return [];

  const scan = input.scan ?? "crossing";
  const out: ConvictionCohort[] = [];
  for (const rung of HOLDING_RUNGS) {
    // In "standing" mode a holder belongs to their HIGHEST rung only — a
    // 45-day believer is a 30-day story, never also a 7-day one, or catch-up
    // would publish the same person's history four times over.
    const crossed = eligible.filter((h) =>
      scan === "standing"
        ? rungFor(h.daysHeld) === rung
        : crossedInWindow(h.daysHeld, rung, windowDays),
    );
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
    // `tribe_holding` is NOT decided here. It depends on who the reader is, and
    // there is no reader at emission — see cohortKindForViewer.
    const kind: CohortKind = founding ? "founding" : "holding";

    const share =
      input.sideBelievers && input.sideBelievers > 0
        ? clamp01(people.length / input.sideBelievers)
        : 0;
    // VIEWER-INDEPENDENT, because this is computed once and stored once. An
    // earlier version spent 30% of the score on "who they are to you" — a term
    // that is structurally ZERO at emission, since the emitter has no viewer and
    // never sets a relationship. That silently deflated every cohort below the
    // publish threshold, which is why quiet markets went quiet twice over. The
    // reader's own relationships are applied where they belong: at read time,
    // as a bounded boost (src/domain/viewer-relationship).
    const significance = clamp01(
      0.6 * rungWeight(rung) + 0.3 * share + (people.length > 1 ? 0.1 : 0),
    );

    // When this group passed the rung. `nowMs` cancels against the same clock
    // that produced `daysHeld`, so two cron runs hours apart — or either side of
    // midnight — derive the identical date.
    const crossedAt = Math.min(...people.map((h) => nowMs - (h.daysHeld - rung) * 86_400_000));
    const crossedOn = new Date(crossedAt).toISOString().slice(0, 10);

    out.push({
      kind,
      side: input.side,
      rung,
      people,
      fingerprint: `cohort:${input.side}:${kind}:${rung}:${crossedOn}`,
      crossedOn,
      significance,
    });
  }
  return out.sort((a, b) => b.significance - a.significance);
}

/** A cohort with the market it belongs to — what an emitter run publishes. */
export interface CohortCandidate {
  marketId: number;
  cohort: ConvictionCohort;
}

/**
 * Which cohorts this run publishes: the strongest `cap`, and nothing else.
 *
 * WHY A CAP AT ALL. Everything else in the feed is paced by trading, which
 * arrives spread out. Cohorts are paced by the CALENDAR, so markets whose
 * believers arrived together reach every rung together — and when a whole
 * platform's history starts on one day (src/domain/tenure), "together" means
 * hundreds of markets in one batch.
 *
 * WHY THIS ISN'T A QUALITY GATE. Nothing here is rejected, only deferred: the
 * ordering is total and deterministic, so the run after this one sees the same
 * list minus what was just written and publishes the next best. A mass crossing
 * therefore drains over successive runs, strongest first, instead of arriving
 * as one wall.
 *
 * The caller MUST exclude already-published fingerprints before calling, or the
 * deterministic ordering will hand back the same winners forever and everything
 * behind them starves. That exclusion is the emitter's job because only it can
 * see what has been written.
 */
export function selectCohortsForRun(
  candidates: CohortCandidate[],
  cap: number = COHORT.maxPerRun,
): CohortCandidate[] {
  return [...candidates]
    .sort(
      (a, b) =>
        b.cohort.significance - a.cohort.significance ||
        b.cohort.rung - a.cohort.rung ||
        b.cohort.people.length - a.cohort.people.length ||
        a.marketId - b.marketId ||
        a.cohort.side.localeCompare(b.cohort.side),
    )
    .slice(0, Math.max(0, cap));
}

/**
 * Is this the READER's own tribe holding? Decided here, at read time, because
 * the answer is different for every reader and identical events must not have
 * different identities. The stored kind is `holding` or `founding`; this can
 * only ever upgrade the SENTENCE, never the fingerprint.
 *
 * Call it after the people have been labelled against the viewer's DNA
 * (src/domain/viewer-relationship#enrichPeople) and nowhere else.
 */
export function cohortKindForViewer(cohort: ConvictionCohort): CohortKind {
  const known = cohort.people.filter(
    (h) => h.relationship === "tribe" || h.relationship === "twin",
  );
  return known.length >= COHORT.groupMin ? "tribe_holding" : cohort.kind;
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
