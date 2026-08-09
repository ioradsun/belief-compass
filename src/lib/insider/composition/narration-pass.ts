/**
 * INSIDER — THE NARRATION PASS.
 *
 * Facts in, sentences out. This is where a grouped row stops being a database
 * shape and becomes a story a person can read: the actor is named, the crowd
 * behind a burst is named, cohorts are rendered for the surface they will
 * appear on, transitions are re-said in the current voice, a new market is made
 * to answer "who opened it", and everything else goes through the conviction
 * grammar and the PI voice.
 *
 * Lifted out of `buildTape` whole and pure — no IO, no clock beyond the one the
 * caller passes. It mutates the rows it is given (`face`, `people`, `story`,
 * `text`) because those rows ARE the feed, and returns the per-row judgements
 * the ranking and question layers downstream depend on.
 */
import {
  flattenStory,
  type LiveFace,
  type LiveRow,
} from "@/lib/live-tape";
import {
  classifyConvictionEvent,
  isCelebration,
  type ConvictionAction,
} from "@/domain/conviction-event";
import { tellPiStory } from "@/domain/pi-voice";
import { retellTransition, type CopyLevel } from "@/domain/transition-denominator";
import { tellNewMarketStory } from "@/domain/new-market-story";
import { enrichPeople, orderForViewer, relationshipBoost } from "@/domain/viewer-relationship";
import { namePerson, knownFirst, type ProfileLike } from "@/domain/feed-people";
import { aliasFor } from "@/lib/wallet-identity";
import {
  cohortKindForViewer,
  renderCohort,
  type CohortHolder,
  type CohortKind,
  type ConvictionCohort,
  type HoldingRung,
} from "@/domain/conviction-cohort";
import type { Momentum } from "@/lib/insider/source.server";

type NetLabel = "twin" | "tribe" | "opp" | "inverse";

/** One member of the crowd behind a burst, as the grouping ordered them. */
export interface BurstStake {
  wallet: string;
  amountUsd: number | null;
}

/** The belief state AFTER the trade, as the read model stores it. */
export interface NarrationBelief {
  yesShares?: number | null;
  noShares?: number | null;
  daysHeld?: number | null;
  tenureIsFloor?: boolean | null;
  enteredBefore?: boolean | null;
}

export interface NarrationPassInput<R extends LiveRow> {
  live: R[];
  profiles: Map<string, ProfileLike>;
  labelByWallet: Map<string, NetLabel>;
  believersByMarket: Map<number, string[]>;
  burstStakes: Map<string, BurstStake[]>;
  beliefByKey: Map<string, NarrationBelief>;
  momentumById: Map<number, Momentum>;
  /** True inside a market panel, which already shows the question and the side. */
  scoped: boolean;
  /** Bounded relationship nudges, written here for cohort rows. */
  viewerBoost: Map<string, number>;
  nowMs?: number;
}

export interface NarrationPassResult {
  /** Cohort members with their tenure kept — the face stack only needs names. */
  cohortPeople: Map<string, CohortHolder[]>;
  /**
   * What each row did to a BELIEF, as the grammar here worked it out. Recorded
   * rather than re-derived, so the sentence a reader sees and the score that let
   * it through can never disagree about what happened.
   */
  actionById: Map<string, ConvictionAction>;
  /** Which rows the grammar classified as a moment rather than a transaction. */
  celebrationById: Map<string, boolean>;
  /**
   * Cohort rows we cannot describe honestly (no kind, no rung, or nobody in
   * them). Better silence than "undefined — 0 believers reached NaN months".
   */
  unrenderable: Set<string>;
  /**
   * THE CEILING A ROW'S OWN COPY PUTS ON ITS VOLUME. A "−100% over 24H" on
   * $1.80, or a bare "first believers just stepped in", is factually fine and
   * editorially a receipt. The signal vector cannot see this — it reads market
   * state, not the sentence we printed — so the ceiling is recorded here.
   */
  copyLevel: Map<string, CopyLevel>;
  /** Rows the copy layer refuses to print at all — see `retellTransition`. */
  copySuppressed: Set<string>;
  /**
   * THE FLOOR, for rows whose evidence does not live in market state. A new
   * market with a proven reaction is a clue, but the signal vector is blind to
   * social kinds. Only ever raises, and only where a fact was proven.
   */
  voiceFloor: Map<string, "observation" | "intelligence">;
}

export function runNarrationPass<R extends LiveRow>({
  live,
  profiles,
  labelByWallet,
  believersByMarket,
  burstStakes,
  beliefByKey,
  momentumById,
  scoped,
  viewerBoost,
  nowMs = Date.now(),
}: NarrationPassInput<R>): NarrationPassResult {
  const cohortPeople = new Map<string, CohortHolder[]>();
  const actionById = new Map<string, ConvictionAction>();
  const celebrationById = new Map<string, boolean>();
  const unrenderable = new Set<string>();
  const copyLevel = new Map<string, CopyLevel>();
  const copySuppressed = new Set<string>();
  const voiceFloor = new Map<string, "observation" | "intelligence">();

  for (const r of live) {
    const w = r.wallet?.toLowerCase();
    // Name the actor / creator when we have one; tag the network relationship.
    if (w) {
      const { name, avatarUrl, relationship } = namePerson(w, profiles, labelByWallet, aliasFor);
      r.face = { name, avatarUrl, relationship } satisfies LiveFace;
    }

    // The crowd behind a burst, named. Ordered by what they committed (the
    // grouping already did that), with the viewer's own people pulled to the
    // front so a familiar face is the first one they see.
    //
    // ONE PERSON, ONE FACE. When the row already has an actor (`r.face`), that
    // wallet is dropped from the stack — the row was showing the same person
    // twice, once as the subject of the sentence and again as "the crowd".
    const stakes = burstStakes.get(r.id);
    if (stakes && !r.people) {
      const seen = new Set<string>(w ? [w] : []);
      const named = stakes
        .filter((s) => !seen.has(s.wallet) && (seen.add(s.wallet), true))
        .map((s) => namePerson(s.wallet, profiles, labelByWallet, aliasFor));
      if (named.length > 0) r.people = knownFirst(named);
    } else if (!r.face && !r.people) {
      // A market signal: no actor, no burst — the believers it is about.
      const believers = believersByMarket.get(Number(r.marketId)) ?? [];
      if (believers.length > 0) {
        r.people = knownFirst(
          believers.map((wallet) => namePerson(wallet, profiles, labelByWallet, aliasFor)),
        );
      }
    }

    // A CONVICTION COHORT — the people still holding. The event stored PEOPLE,
    // not prose, precisely so the sentence can be written for where it is
    // being read: this request knows whether it is the app-wide tape or one
    // market's panel (`scoped`), so it strips the market title and the side
    // exactly when the surrounding UI supplies them.
    if (r.kind === "conviction_cohort") {
      const p = r.payload as unknown as {
        kind: CohortKind;
        side: "YES" | "NO";
        rung: HoldingRung;
        significance: number;
        crossedOn?: string;
        people: CohortHolder[];
      };
      // A cohort sentence is only true if we know WHO, WHICH SIDE and HOW
      // LONG. Missing any of the three, the row is dropped, never guessed.
      if (
        !p?.kind ||
        !p?.side ||
        !Number.isFinite(Number(p?.rung)) ||
        !Array.isArray(p?.people) ||
        p.people.length === 0
      ) {
        unrenderable.add(r.id);
        continue;
      }
      const cohort: ConvictionCohort = {
        kind: p.kind,
        side: p.side,
        rung: p.rung,
        people: p.people ?? [],
        fingerprint: `cohort:${p.side}:${p.kind}:${p.rung}:${p.crossedOn ?? ""}`,
        crossedOn: p.crossedOn ?? "",
        significance: p.significance ?? 0,
      };
      // VIEWER LENS, applied here and nowhere else. The stored event is
      // universal; this labels the people against THIS reader's DNA cache and
      // leads the stack with the ones they know. Identity is untouched — same
      // row, same fingerprint, same members, same overflow count.
      const mine = enrichPeople(cohort.people, labelByWallet);
      cohort.people = orderForViewer(mine);
      cohortPeople.set(r.id, cohort.people);
      // "YOUR PEOPLE ARE HERE" is a claim about the READER, so it is decided
      // here rather than stored. The emitter has no viewer and could never
      // reach this kind — which is why the headline was unreachable until now.
      cohort.kind = cohortKindForViewer(cohort);
      const surface = scoped ? "panel" : "app";
      const story = renderCohort(cohort, surface, r.marketTitle);
      r.story = {
        category: cohort.kind === "tribe_holding" ? "tribe" : "growing",
        headline: story.headline,
        body: story.body,
        attribution: null,
        tone: p.side === "YES" ? "yes" : "no",
        personal: cohort.kind === "tribe_holding",
      };
      r.people = cohort.people;
      r.text = flattenStory(r.story);
      // Bounded, and only ever a nudge — see viewer-relationship.
      viewerBoost.set(r.id, relationshipBoost(cohort.people));
      continue;
    }

    // Market-wide transitions carry their own composed copy in the payload
    // (the emitter already ran the interpretation + dedup) — render it directly.
    if (r.kind === "market_transition") {
      const p = r.payload as { headline?: string; detail?: string | null; type?: string | null };
      /**
       * THE EVENT OWNS ITS OWN ROW.
       *
       * "MAJOR MOVE / Money is leaving YES" spends the loudest line in the row
       * on a category name and demotes the only interesting phrase to the
       * subtitle. Both wrappers were generic by construction — every signal got
       * one of two labels — which is exactly what makes a feed read as
       * machine-generated. The composed headline IS the kicker now; the detail
       * (the number and the window) is the sentence under it.
       */
      /* STORED COPY IS FROZEN AT EMIT TIME, so rows written before the PI voice
         still speak the old product's language forever. `retellTransition`
         recognises those labels at read time and re-says them in the current
         voice, using only the numbers the stored detail already printed. */
      /* AND THE PERCENTAGE GETS ITS DENOMINATOR BACK. The emitter froze
         "−100% over 24H" without knowing whether that was $2,000 or $1.80; the
         side's 24h capital movement is the money the percentage was computed
         over, and it lives in market state, here. */
      const mkt = momentumById.get(Number(r.marketId));
      const delta = r.side === "NO" ? mkt?.noCapitalDelta24h : mkt?.yesCapitalDelta24h;
      /* market_state's *_capital_delta_24h is already USD (derived from
         yes/no_capital_usd against the 24h snapshot), unlike the sibling
         capital_held_* columns which are ETH. No conversion here. */
      const deltaUsd =
        typeof delta === "number" && Number.isFinite(delta) ? Math.abs(delta) : null;
      const modern = retellTransition(p.headline ?? "", p.detail ?? "", String(r.id), {
        usd: deltaUsd,
        side: r.side ?? null,
      });
      copyLevel.set(r.id, modern.level);
      if (modern.suppress) copySuppressed.add(r.id);
      const kicker = modern.headline.trim();
      r.story = {
        category: "momentum",
        headline: kicker ? kicker.toUpperCase() : "MARKET SIGNAL",
        body: modern.detail,
        attribution: null,
        tone: r.side === "YES" ? "yes" : r.side === "NO" ? "no" : "neutral",
        personal: false,
      };

      r.text = flattenStory(r.story);
      continue;
    }

    /* A NEW MARKET MUST ANSWER "WHO PUT IT THERE" AND "DID ANYONE REACT".
       "ON THE TABLE / <question>" is inventory — it names a thing that exists
       and nothing that happened. The creator wallet rides on the event, the
       reaction is in market state, and the admission grade follows from which
       of those facts exist. Nothing here manufactures either one: a bare
       creation is receipt-grade and gets dropped from the primary surface. */
    if (r.kind === "market_created") {
      const m = momentumById.get(Number(r.marketId));
      const openedMs = r.occurredAt ? Date.parse(r.occurredAt) : NaN;
      const ageHours = Number.isFinite(openedMs) ? (nowMs - openedMs) / 3_600_000 : null;
      // Someone the reader knows who is already in — a fact, or nothing.
      const known = (believersByMarket.get(Number(r.marketId)) ?? [])
        .map((wallet) => namePerson(wallet, profiles, labelByWallet, aliasFor))
        .find((p) => p.relationship != null && p.name);
      const verdict = tellNewMarketStory({
        creatorName: r.face?.name ?? null,
        creatorRelationship: r.face?.relationship ?? null,
        ageHours,
        believersYes: m?.believersYes ?? null,
        believersNo: m?.believersNo ?? null,
        // Held capital is stored in ETH on this read model; the row does not
        // claim a dollar figure it cannot prove, so reaction is counted in people.
        capitalUsd: null,
        personal: known
          ? { name: known.name, relationship: String(known.relationship), side: null }
          : null,
      });
      if (verdict.suppress) copySuppressed.add(r.id);
      if (verdict.level === "receipt") copyLevel.set(r.id, "receipt");
      else if (verdict.level === "observation") copyLevel.set(r.id, "observation");
      else voiceFloor.set(r.id, "intelligence");
      if (verdict.story) {
        r.story = verdict.story;
        r.text = flattenStory(r.story);
      }
      continue;
    }

    // Milestone / surge rows are already final from grouping (no actor to name).
    if (r.kind === "believer_milestone" || r.kind === "tribe_doubled") continue;

    const market = momentumById.get(Number(r.marketId)) ?? null;
    const buySell = (r.payload as { action?: "BUY" | "SELL" }).action ?? null;
    const actor = r.face ? { name: r.face.name, relationship: r.face.relationship } : null;
    const belief = w ? beliefByKey.get(`${w}:${Number(r.marketId)}`) : undefined;

    // WHAT THEY DID TO THEIR BELIEF, not which way the tokens went. A buy on
    // top of an existing position is an ADD (doubling down); a sell that
    // leaves nothing is an EXIT, one that leaves something is a REDUCE. The
    // read model is the state AFTER the trade, so shares==0 means they're out.
    const heldSide = r.side === "YES" ? belief?.yesShares : belief?.noShares;
    const action: ConvictionAction =
      r.kind === "market_created"
        ? "open_market"
        : r.kind === "believer_milestone"
          ? "milestone"
          : r.kind === "tribe_doubled"
            ? "surge"
            : r.kind === "side_shift"
              ? "flip"
              : r.kind === "round_trip"
                ? "round_trip"
                : buySell === "SELL"
                  ? heldSide != null && heldSide > 0
                    ? "reduce"
                    : "exit"
                  : belief?.enteredBefore
                    ? "add"
                    : "enter";

    actionById.set(r.id, action);

    const sideBelievers =
      r.side === "YES" ? market?.believersYes : r.side === "NO" ? market?.believersNo : null;

    // ONE CLASSIFICATION, USED TWICE. The grammar already decides whether this
    // is a moment or a transaction; the mixer needed to know and was never
    // told, so every celebration competed as an ordinary buy. See
    // `familyOf` (src/domain/feed-cadence) for what that cost.
    const convictionEvent = {
      action,
      side: r.side,
      actor,
      context: {
        amountUsd: r.amountUsd,
        // Only claim a tenure when this row has ONE actor we actually looked up.
        daysHeld: belief?.daysHeld ?? null,
        tenureIsFloor: belief?.tenureIsFloor ?? null,
        heldBefore: belief?.enteredBefore ?? null,
        sideBelieversAfter: sideBelievers ?? null,
        peopleCount: r.walletCount,
        question: r.kind === "market_created" ? r.marketTitle : null,
        threshold:
          r.kind === "believer_milestone"
            ? Number((r.payload as { threshold?: number }).threshold ?? 0)
            : null,
      },
    };
    celebrationById.set(r.id, isCelebration(classifyConvictionEvent(convictionEvent)));
    // Facts above, voice here — the PI layer only chooses HOW this is said
    // (src/domain/pi-voice); the row id keeps that choice frozen per row.
    r.story = tellPiStory(convictionEvent, r.id);
    r.text = flattenStory(r.story);
  }

  return {
    cohortPeople,
    actionById,
    celebrationById,
    unrenderable,
    copyLevel,
    copySuppressed,
    voiceFloor,
  };
}
