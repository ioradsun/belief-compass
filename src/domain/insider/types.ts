/**
 * THE INSIDER — the single-resource contract.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE CONSTITUTIONAL RULE (see ./README.md and docs/insider-architecture.md)
 *
 *   No product surface calculates market intelligence.
 *   Facts are produced by the canonical data systems (events, wallet_beliefs,
 *   market_state). THE INSIDER interprets those facts. Product surfaces only
 *   FILTER, AGGREGATE, PERSONALIZE, and RENDER Insider output.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS FILE IS
 *
 * One intelligence system, four projections — not four intelligence systems that
 * happen to share some data. This file is the common vocabulary those projections
 * roll up into. It is TYPES ONLY: zero IO, no calculation, no imports that reach
 * the database. The projections (activity / insight / now / read) and the builder
 * that fills these shapes from canonical facts live alongside it as they migrate
 * inward; today the calculations still live in the modules named against each
 * field below, and this contract is the shape they are converging on.
 *
 * THE SINGLE-RESOURCE PRINCIPLE, STATED HONESTLY. "One resource" is a single
 * domain CONTRACT, not one giant API object every screen downloads. `InsiderMarket`
 * is the per-market resource; `InsiderNow` is the global feed resource. They are
 * separate cache scopes so global facts stay highly cacheable while the viewer
 * overlay is layered on afterward — same computation system, different projections.
 *
 * WHY EVIDENCE AND JUDGMENT ARE SEPARATE. Calculate the underlying evidence ONCE
 * (freshness, velocity, magnitude, capital flow, participation, imbalance,
 * novelty, relationship, stake, confidence). Then each surface answers a DIFFERENT
 * question from that same evidence. There is deliberately no single `insiderScore`
 * — collapsing every question into one number is what eventually makes the product
 * stupid. Activity asks "what just happened?", Insight asks "what does it mean?",
 * Now asks "what deserves attention?", Read asks "what does it mean for YOU?".
 */

/** The only two directional sides. Mirrors house-read's `ReadSide`. */
export type Side = "YES" | "NO";

/** Version of THIS contract's shape. Bump on any breaking field change. */
export const INSIDER_CONTRACT_VERSION = 1 as const;

// ─────────────────────────────────────────────────────────────────────────────
// SIGNAL KINDS — what an Insider signal can be ABOUT.
//
// A unifying superset of the kinds today's modules emit independently:
//   • market anomalies  → src/domain/signal-vector.ts  (SignalKey)
//   • standing intel     → src/domain/standing-story.ts  (StandingStoryKind)
//   • position transitions → events `source='system'` kinds (see data-flow.md §4)
//   • milestones/discovery → src/domain/significance.ts (scoreMilestone/scoreDiscoveryMoment)
// A signal names ONE kind; composition into a story happens above this layer.
// ─────────────────────────────────────────────────────────────────────────────
export type InsiderSignalKind =
  // market-shape anomalies (signal-vector SignalKey)
  | "tension"
  | "before_price"
  | "unusual"
  | "concentration"
  | "reversing"
  | "building"
  | "nonresponse"
  // canonical activity
  | "trade"
  | "entered"
  | "exited"
  | "side_flip"
  | "market_created"
  // derived transitions / milestones
  | "became_directional"
  | "new_believers"
  | "milestone"
  | "discovery_moment"
  // standing intelligence (who is still here)
  | "standing";

export const INSIDER_SIGNAL_KINDS: readonly InsiderSignalKind[] = [
  "tension",
  "before_price",
  "unusual",
  "concentration",
  "reversing",
  "building",
  "nonresponse",
  "trade",
  "entered",
  "exited",
  "side_flip",
  "market_created",
  "became_directional",
  "new_believers",
  "milestone",
  "discovery_moment",
  "standing",
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// UNIVERSAL EVIDENCE — calculated ONCE per signal, interpreted per surface.
//
// Every value is 0..1 normalized unless noted. `null` means "not computed" and is
// NEVER the same as 0 — the distinction is what keeps sparse markets quiet
// (see signal-vector.ts SignalFacts). These are the raw dimensions; the scores
// below are judgments derived from them.
// ─────────────────────────────────────────────────────────────────────────────
export interface InsiderEvidence {
  /** How big the underlying move is, vs the market's own normal. ← signal-vector marketGain / unusualness. */
  magnitude: number | null;
  /** Rate of change / acceleration of the move. ← feed/momentum accelerationOf. */
  velocity: number | null;
  /** Change in how many people are involved. ← wallet_beliefs new-believers / peopleYesChange24h. */
  participation: number | null;
  /** Net capital flow behind the move. ← market_state / signal-vector capitalDelta. */
  capitalFlow: number | null;
  /** Directional lopsidedness (how one-sided YES vs NO is). ← market-pulse / side imbalance. */
  imbalance: number | null;
  /** How unprecedented this is for this market. ← discovery.ts discoveryValue. */
  novelty: number | null;
  /** How recent — decays with age. ← events.occurred_at recency. */
  freshness: number | null;
}

/** An evidence object with nothing computed — the quiet default. */
export const NO_EVIDENCE: InsiderEvidence = {
  magnitude: null,
  velocity: null,
  participation: null,
  capitalFlow: null,
  imbalance: null,
  novelty: null,
  freshness: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// VIEWER OVERLAY — added only when there is a viewer, never part of global facts.
// Kept separate so the global evidence stays cacheable and side-blind.
// ─────────────────────────────────────────────────────────────────────────────
export interface InsiderViewerOverlay {
  /** Strength of the viewer's relationship to the actors. ← viewer-relationship relationshipBoost. */
  relationship: number | null;
  /** The viewer's own stake in the market (created / holding). ← viewer-stake stakeBoost. */
  stake: number | null;
  /** How relevant this is to THIS viewer overall. ← composed relevance (Phase 6, not yet built). */
  personalRelevance: number | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM JUDGMENTS — the interpretations the Insider draws from the evidence.
// Distinct scores because they answer distinct questions; there is no single
// rolled-up "insiderScore".
// ─────────────────────────────────────────────────────────────────────────────
export interface InsiderJudgment {
  /** How strongly, and which way, momentum is running. ← feed/momentum classifyMomentum. */
  momentumScore: number;
  /** How much this deserves to interrupt someone. ← significance.ts compose/scoreLiveAction. */
  importanceScore: number;
  /** How sure the Insider is about the read. 0..1. */
  confidence: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROVENANCE — every signal is traceable back to canonical facts, and versioned
// so a replay of identical inputs produces identical signals (the migration's
// fixture/parity contract).
// ─────────────────────────────────────────────────────────────────────────────
export interface InsiderProvenance {
  /** The canonical `events` rows this signal was derived from. */
  sourceEventIds: string[];
  /** Machine-readable reasons (why it fired), stable across copy changes. */
  reasonCodes: string[];
  /** The builder version that produced it — for replay/parity. */
  builderVersion: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// INSIDER SIGNAL — the atom. One interesting thing the Insider noticed, with the
// evidence for it, optional viewer overlay, the system's judgments, and full
// provenance. Everything else in the contract is an aggregation or projection of
// these.
// ─────────────────────────────────────────────────────────────────────────────
export interface InsiderSignal {
  id: string;
  marketId: number;
  kind: InsiderSignalKind;
  /** The side this is about, when it has one. */
  side?: Side | null;
  /** ISO timestamp of the canonical fact this is about (events.occurred_at). */
  occurredAt: string;

  evidence: InsiderEvidence;
  /** Present only when built for a specific viewer. */
  viewer?: InsiderViewerOverlay;
  /**
   * Optional: present only once a projection has SCORED this signal (Now /
   * Insight). A pure chronological Activity signal is unscored — omitting the
   * judgment is honest, and matches "evidence once, interpreted per surface".
   */
  judgment?: InsiderJudgment;
  provenance: InsiderProvenance;

  /** Kind-specific detail (actors, amounts, holders…). Opaque to the contract. */
  payload?: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROJECTION 1 — INSIDER PULSE / INSIGHT: "what does everything here MEAN?"
// The aggregate read of a market. ← today: MarketVitality + market-pulse + market-vitals.
// ─────────────────────────────────────────────────────────────────────────────
export type InsiderPulseDirection = "YES" | "NO" | "BALANCED";

export interface InsiderPulse {
  direction: InsiderPulseDirection;
  momentum: number;
  acceleration: number;
  activity: number;
  participation: number;
  capitalFlow: number;
  imbalance: number;
  volatility: number;
  novelty: number;
  /** ISO of the last thing worth noticing here, or null if quiet. */
  lastInterestingEventAt: string | null;
}

/** The human explanation of the pulse — one headline, one supporting sentence. */
export interface InsiderInsight {
  /** e.g. "YES is gaining momentum." */
  headline: string;
  /** e.g. "8 new believers joined in 3h while YES capital grew 21%." */
  detail: string;
  direction: InsiderPulseDirection;
  /** The same values that produced this sentence also cause Now stories to appear. */
  pulse: InsiderPulse;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROJECTION 2 — INSIDER NOW: "what deserves my attention?"
// Editorially ranked, corroborated, grouped stories. ← today: LiveTape + live.functions
// + significance + discovery + feed-editorial + standing-story + pi-question/pi-voice.
// ─────────────────────────────────────────────────────────────────────────────
export interface InsiderStory {
  id: string;
  marketId: number;
  /** Surface-ready narrative line (PI voice). */
  text: string;
  side?: Side | null;
  occurredAt: string;
  /** The signals this story corroborates / composes. */
  signalIds: string[];
  importanceScore: number;
  novelty: number;
  freshness: number;
  /** Present only for a viewer: why THIS reader should care. */
  personalRelevance?: number | null;
}

export interface InsiderNow {
  stories: InsiderStory[];
  /** Opaque pagination cursor over the same Insider history. */
  cursor: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROJECTION 3 — INSIDER ACTIVITY: "what just happened (on this side)?"
// The simplest projection — mostly chronological filtering over the same signals.
// ← today: CurrentMarketActivity + CaseFile "Insider Moves" + live.functions.
// A rail is just `activity({ marketId, side })` — a filter, not a bespoke engine.
// ─────────────────────────────────────────────────────────────────────────────
export interface InsiderActivityQuery {
  marketId: number;
  side?: Side;
  limit?: number;
}

export interface InsiderActivity {
  marketId: number;
  side?: Side | null;
  /** Chronological signals, newest first. */
  signals: InsiderSignal[];
}

// ─────────────────────────────────────────────────────────────────────────────
// PROJECTION 4 — INSIDER READ: "given everything, what do we think YOU will do?"
// The personal projection. ← today: HouseRead + house-read.ts (kept as-is; its
// inputs expand from "your DNA" to "your DNA + everything Insider sees here").
// This mirrors HouseReadState so the existing state machine drops straight in.
// ─────────────────────────────────────────────────────────────────────────────
export type InsiderReadStatus =
  | "learning"
  | "predicted"
  | "pass_predicted"
  | "correct"
  | "incorrect"
  | "closed";

export interface InsiderRead {
  status: InsiderReadStatus;
  /** The side the Insider is calling, when it has a call. A settled round may be PASS. */
  predictedSide?: Side | "PASS" | null;
  /** What the viewer actually did, once a round settles. */
  actualSide?: Side | "PASS" | null;
  /** Cold start: how many more picks until the Insider will call your move. */
  remainingPicks?: number | null;
  /**
   * THE ONE LOCKED REASON, revealed only after the choice is complete. Chosen
   * server-side in priority order (category history → closest matches → overall
   * behaviour → pass behaviour). Never computed by a surface, never a paragraph.
   */
  reason?: string | null;
  /** This market's category, used only for the broken-pattern comparison. */
  category?: string | null;
}


// ─────────────────────────────────────────────────────────────────────────────
// THE PER-MARKET RESOURCE — the single logical contract for one market.
// Assembled from the projections above; a screen reads the slice it needs.
// `read` is optional and viewer-scoped so the rest stays globally cacheable.
// ─────────────────────────────────────────────────────────────────────────────
export interface InsiderMarket {
  marketId: number;
  pulse: InsiderPulse;
  insight: InsiderInsight;
  signals: InsiderSignal[];
  activity: {
    yes: InsiderSignal[];
    no: InsiderSignal[];
  };
  /** Present only when built for a viewer. */
  read?: InsiderRead;
}

/** The four projections, named. Every information surface is one of these. */
export type InsiderSurface = "activity" | "insight" | "now" | "read";
