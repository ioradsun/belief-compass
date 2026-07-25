/**
 * conviction.company — Conviction Signal Feed, pure layer.
 *
 * ZERO IO. No Date.now (callers pass `now`), no network, no DB. Everything here
 * is the universal grammar from the v1 spec turned into functions:
 *
 *   [ wealth ] → [ actor @ scale ] → [ one of 5 behaviors ] → [ price + context ]
 *
 * The actor is a PARAMETER, not a type — individual / group / market all render
 * through one shape, differing only in how wealth is summed and how the identity
 * row degrades. Wealth claims and attribution verbs only ever say what the data
 * proves (tier-1 capital flow here; realized/unrealized are later, gated tiers).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import type { CardCopy } from "./feed-copy";

/**
 * Ambient market context shown on every card — where the MARKET stands, never
 * what the card's event did. Implied probability (money-weighted YES%), the 24h
 * pulse, and a trajectory whose window is labeled truthfully to whatever history
 * has actually accrued.
 */
export interface PriceBlock {
  impliedPct: number | null; // current money-weighted YES probability, 0..100
  chg24h: number | null; // signed change in implied % over ~24h
  series: number[]; // downsampled implied % over the window, oldest → newest
  windowDays: number; // actual span of the series (may be < 60)
  windowLabel: string; // truthful label: "2 months" / "3 weeks" / "5 days"
}

export type ActorScale = "individual" | "group" | "market" | "none";
export type ActorRole =
  | "people"
  | "opp" // individuals (viewer-relative)
  | "tribe"
  | "rivals" // crowds (viewer-relative)
  | "creator" // authorship
  | "market" // network scale, weakest attribution
  | null;

/** Honesty tier of a wealth figure. Only `flow` is computable without cost basis. */
export type WealthTier = "flow" | "realized" | "unrealized";
export type Side = "YES" | "NO";
export type FeedAction = "open" | "back_yes" | "back_no" | "review";

export interface WealthLine {
  usd: number;
  direction: "in" | "out";
  side: Side | null; // null = network aggregate, no single side
  tier: WealthTier;
  text: string; // "$8.4M entered YES"
}

/** A wallet's displayable identity: real POV profile when known, generated otherwise. */
export interface AvatarRef {
  wallet: string;
  alias: string; // neutral generated fallback name
  displayName: string | null; // real POV name when known
  pfpUrl: string | null; // real POV pic when known
}

export interface ActorIdentity {
  scale: ActorScale;
  role: ActorRole;
  badge: string; // "PEOPLE" · "OPP" · "THE MARKET" · "CREATOR" …
  alias: string | null; // individuals only; groups/market render badge only
  matchPct: number | null; // ring fill 0..100; individuals only. Never shown as text.
  displayName: string | null; // real POV name, preferred over alias when present
  pfpUrl: string | null; // real POV pic; null → generated initials avatar
}

export interface FeedCard {
  id: string;
  onchain_id: number;
  marketTitle: string;
  wealth: WealthLine | null; // null when there is no honest money figure yet
  actor: ActorIdentity | null; // null = unattributed → no identity row at all
  story: string; // the ONE sentence — the only part that reads as language
  priceSide: Side | null;
  priceChgPct: number | null; // % move; null when there's no move yet
  impliedYesPct: number | null; // current market odds (money-weighted YES%) — the "price" when there's no move
  peopleYesPct: number | null; // head-count YES% — for the tension split-screen
  yesCapitalUsd: number | null; // capital backing YES (per-side market cap)
  noCapitalUsd: number | null; // capital backing NO
  volume24hUsd: number | null; // 24h volume → buying pressure
  context: string | null; // one fact: "held 73 days" / "143 new believers"
  convictionPct: number | null; // actor's conviction 0..100 (individual/creator); null at network scale
  believersYes: number | null;
  believersNo: number | null;
  crowd: AvatarRef[]; // backer avatars for the stack (capped); empty for pure individual cards
  crowdTotal: number; // total backers, so the stack can render a "+N" overflow
  price: PriceBlock | null; // ambient market context (implied % / 24h / sparkline)
  copy: CardCopy | null; // composed story (hook/belief/story/turn/action) — set for shown cards
  actorWallet: string | null; // primary actor's wallet, for the "See Their Convictions" deep-link
  action: FeedAction;
  signalType: string; // internal only — ranking + analytics, never rendered
  score: number;
  occurredAt: string; // when this signal happened — drives the "time ago" stamp
}

// ---------------------------------------------------------------------------
// Wealth formatting — dollars by default, never raw ETH as the lead.
// ---------------------------------------------------------------------------

export function fmtUsd(n: number): string {
  const v = Math.abs(Math.round(n));
  if (v >= 1e6) return `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
  if (v >= 1e3) return `$${Math.round(v / 1e3)}k`;
  return `$${v.toLocaleString("en-US")}`;
}

/**
 * Tier-1 capital flow: trade size × price, summed. Always honest — no cost basis
 * needed. `text` uses human capital-flow verbs ("entered" / "left" / "committed"),
 * never a verb that implies profit the data hasn't proven.
 */
export function wealthFlow(
  usd: number,
  direction: "in" | "out",
  side: Side | null,
): WealthLine | null {
  if (!(usd > 0)) return null;
  const money = fmtUsd(usd);
  let text: string;
  if (side == null) {
    // Network scale: attributable to no one → weakest verb.
    text = `${money} committed today`;
  } else if (direction === "in") {
    text = `${money} entered ${side}`;
  } else {
    text = `${money} left ${side}`;
  }
  return { usd, direction, side, tier: "flow", text };
}

// ---------------------------------------------------------------------------
// Actor identity — badge/alias/ring, viewer-relative. Chrome, not a sentence.
// ---------------------------------------------------------------------------

/** Real POV identity for a wallet, when we have it cached. */
export interface WalletProfile {
  displayName: string | null;
  pfpUrl: string | null;
}

export function individualActor(
  role: "people" | "opp",
  wallet: string,
  matchPct: number | null,
  profile?: WalletProfile | null,
): ActorIdentity {
  return {
    scale: "individual",
    role,
    badge: role === "people" ? "PEOPLE" : "OPP",
    alias: aliasFor(wallet),
    matchPct: matchPct == null ? null : Math.max(0, Math.min(100, matchPct)),
    displayName: profile?.displayName ?? null,
    pfpUrl: profile?.pfpUrl ?? null,
  };
}

export function marketActor(): ActorIdentity {
  return {
    scale: "market",
    role: "market",
    badge: "THE MARKET",
    alias: null,
    matchPct: null,
    displayName: null,
    pfpUrl: null,
  };
}

export function creatorActor(wallet: string | null, profile?: WalletProfile | null): ActorIdentity {
  return {
    scale: "individual",
    role: "creator",
    badge: "CREATOR",
    alias: wallet ? aliasFor(wallet) : null,
    matchPct: null,
    displayName: profile?.displayName ?? null,
    pfpUrl: profile?.pfpUrl ?? null,
  };
}

// ---------------------------------------------------------------------------
// Relationship axis — the conviction-match ring around an actor's avatar.
//
// Hue encodes ALIGNMENT ↔ OPPOSITION (purple ↔ grey ↔ red); it is a spectrum,
// not a traffic light. Deliberately NOT green/yellow/red: opposition is valuable
// signal, not a warning, and green/red are reserved for P&L (see the palette
// rule in ConvictionFeed.tsx). Strength (distance from neutral) fills the ring
// equally for both poles, so a strong Opp is as visually present as strong
// People. Thresholds are config, not literals.
// ---------------------------------------------------------------------------

export const MATCH_THRESHOLDS = {
  strongAlign: 90, // ≥ → deep purple (your People)
  moderateAlign: 70, // ≥ → muted purple
  neutral: 50, // the ambiguous midpoint; mirrored for opposition (30 / 10)
} as const;

export type RelationshipBucket =
  "strong-align" | "moderate-align" | "neutral" | "moderate-oppose" | "strong-oppose";

/** Map a 0..100 match score (50 = neutral) to a symmetric relationship bucket. */
export function relationshipBucket(matchPct: number): RelationshipBucket {
  const m = Math.max(0, Math.min(100, matchPct));
  const moderateOppose = 100 - MATCH_THRESHOLDS.moderateAlign; // 30
  const strongOppose = 100 - MATCH_THRESHOLDS.strongAlign; // 10
  if (m >= MATCH_THRESHOLDS.strongAlign) return "strong-align";
  if (m >= MATCH_THRESHOLDS.moderateAlign) return "moderate-align";
  if (m > moderateOppose) return "neutral";
  if (m > strongOppose) return "moderate-oppose";
  return "strong-oppose";
}

export const RELATIONSHIP_COLOR: Record<RelationshipBucket, string> = {
  "strong-align": "#6d28d9", // deep purple
  "moderate-align": "#a78bfa", // muted purple
  neutral: "#9ca3af", // grey
  "moderate-oppose": "#f87171", // muted red
  "strong-oppose": "#b91c1c", // deep red
};

export function relationshipColor(matchPct: number): string {
  return RELATIONSHIP_COLOR[relationshipBucket(matchPct)];
}

/** 0..1 distance from neutral — fills the ring for BOTH poles. */
export function relationshipStrength(matchPct: number): number {
  const m = Math.max(0, Math.min(100, matchPct));
  return Math.min(1, Math.abs(m - MATCH_THRESHOLDS.neutral) / MATCH_THRESHOLDS.neutral);
}

/** Below neutral = opposed. Used as the redundant (non-hue) ring channel. */
export function isOpposed(matchPct: number): boolean {
  return matchPct < MATCH_THRESHOLDS.neutral;
}

// ---------------------------------------------------------------------------
// Neutral aliases — deterministic adjective + noun, seeded by wallet hash.
// The pool is intentionally NON-evaluative: no "Rich", "Smart", "Lucky" — an
// accidental "Lucky Bull" becomes a reputation the wallet never earned.
// ---------------------------------------------------------------------------

const ADJECTIVES = [
  "Quiet",
  "Amber",
  "Orange",
  "Slate",
  "Cobalt",
  "Umber",
  "Jade",
  "Ivory",
  "Cedar",
  "Dusk",
  "Copper",
  "Indigo",
  "Hazel",
  "Ashen",
  "Basalt",
  "Marble",
  "Sable",
  "Verdant",
  "Onyx",
  "Pale",
  "Russet",
  "Teal",
  "Ochre",
  "Flint",
];
const NOUNS = [
  "Fox",
  "River",
  "Heron",
  "Falcon",
  "Otter",
  "Willow",
  "Marten",
  "Sparrow",
  "Bison",
  "Lynx",
  "Crane",
  "Badger",
  "Hawk",
  "Wren",
  "Ibis",
  "Stag",
  "Vole",
  "Finch",
  "Moth",
  "Elk",
  "Owl",
  "Kite",
  "Roe",
  "Pine",
];

/** FNV-1a over the lowercased hex. Stable forever for a given wallet. */
function hashWallet(wallet: string): number {
  let h = 0x811c9dc5;
  const s = wallet.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function aliasFor(wallet: string): string {
  const h = hashWallet(wallet);
  const adj = ADJECTIVES[h % ADJECTIVES.length];
  const noun = NOUNS[(h >>> 8) % NOUNS.length];
  return `${adj} ${noun}`;
}

/** Two initials for a generated avatar, from a real name or the neutral alias. */
export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Deterministic hue (0..359) for a generated avatar, seeded by wallet. */
export function hueFor(wallet: string): number {
  return hashWallet(wallet) % 360;
}

/** Build an AvatarRef, preferring real POV identity, falling back to the alias. */
export function avatarRef(wallet: string, profile?: WalletProfile | null): AvatarRef {
  return {
    wallet,
    alias: aliasFor(wallet),
    displayName: profile?.displayName ?? null,
    pfpUrl: profile?.pfpUrl ?? null,
  };
}

// ---------------------------------------------------------------------------
// Behaviors — the five any actor can do, plus context helpers. The behavior IS
// the label; we never render internal type names. Attribution verbs are earned:
// default to the weakest true statement, climb only when timing + size support it.
// ---------------------------------------------------------------------------

export interface AttributionEvidence {
  /** Actor's own capital in this move, as a fraction of the total move (0..1). */
  shareOfMove: number;
  /** True if the actor acted before the price move (from block_number vs path). */
  actedBefore: boolean;
  /** True if the actor acted during the move. */
  actedDuring: boolean;
}

/** joined → contributed → accelerated → drove. Weakest true verb by default. */
export function attributionVerb(e: AttributionEvidence | null): string {
  if (!e) return "joined the buyers";
  if (e.actedBefore && e.shareOfMove >= 0.25) return "drove the move";
  if (e.actedDuring && e.shareOfMove >= 0.15) return "accelerated the move";
  if (e.shareOfMove >= 0.15) return "contributed to the move";
  return "joined the buyers";
}

export function fmtCount(n: number, singular: string, plural = `${singular}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? singular : plural}`;
}

export function pricePctText(side: Side | null, chg: number | null): string | null {
  if (side == null || chg == null) return null;
  const sign = chg >= 0 ? "+" : "";
  return `${side} ${sign}${chg.toFixed(0)}%`;
}

// ---------------------------------------------------------------------------
// Ranking — "most interesting money move, then explain it."
// how much wealth moved > who's behind it > how meaningful > how unusual > recent.
// Early conviction signals and People+Opp convergence override to the top.
// ---------------------------------------------------------------------------

export const RANK_WEIGHTS = {
  wealth: 12, // log10($) — the visceral hook and primary axis
  attribution: 8, // a move your People/Opp drove beats an unattributed one
  meaningful: 4, // largest-conviction / long holds over small opens
  surprise: 5, // contradicts the actor's own pattern
  recencyPerHour: -0.15,
  earlySignalOverride: 40, // person acted before any price reaction
  convergenceOverride: 100, // People + Opp on the same side — rarest signal
  unattributedPenalty: -6, // "nobody in your graph moved" ranks below any attributed move
} as const;

export interface RankInputs {
  wealthUsd: number;
  attribution: number; // 0 none, 1 market, 2 creator, 3 tribe/rivals, 4 people/opp
  meaningful: number; // 0..1
  surprise: number; // 0..1
  ageHours: number;
  earlySignal?: boolean;
  convergence?: boolean;
  unattributed?: boolean;
}

export function rankScore(i: RankInputs): number {
  let s = 0;
  s += Math.log10(1 + Math.max(0, i.wealthUsd)) * RANK_WEIGHTS.wealth;
  s += i.attribution * (RANK_WEIGHTS.attribution / 4);
  s += i.meaningful * RANK_WEIGHTS.meaningful;
  s += i.surprise * RANK_WEIGHTS.surprise;
  s += Math.max(0, i.ageHours) * RANK_WEIGHTS.recencyPerHour;
  if (i.earlySignal) s += RANK_WEIGHTS.earlySignalOverride;
  if (i.convergence) s += RANK_WEIGHTS.convergenceOverride;
  if (i.unattributed) s += RANK_WEIGHTS.unattributedPenalty;
  return s;
}
