/**
 * DISCOVERY — "is there someone here I should meet?"
 *
 * Every other scorer in this app answers "what happened?". This one answers a
 * different question, and it is the question the product is actually for:
 *
 *     Would this event introduce the viewer to someone worth knowing?
 *
 * Markets are the context. People are the product. A $50 buy by your Twin can
 * matter more than a $5,000 buy by a stranger, because one of them opens a
 * relationship and the other is a number. Significance cannot express that —
 * significance is universal and the $5,000 trade genuinely IS the bigger event.
 * So discovery is a SECOND dimension, not a nudge to the first, and the mixer
 * blends them (src/domain/feed-cadence).
 *
 * WHY NOT FOLD IT INTO SIGNIFICANCE. Two reasons, and they are the same reason
 * viewer-relationship is a read-time lens. (1) Significance belongs to the event
 * and is identical for every reader; discovery is one reader's view. (2) A term
 * bounded small enough to be safe inside significance (≤0.15, see
 * viewer-relationship) can never make a Twin's small buy outrank a whale — which
 * is precisely the reordering this layer exists to perform.
 *
 * THE RULES, all tested:
 *
 *   NEVER OPTIMIZE FOR CELEBRITY. Discovery does not read a dollar amount, ever.
 *   Not position size, not trade size, not portfolio value. Money is what the
 *   market is made of; it is not evidence that a person is worth meeting. Rank by
 *   relevance — relationship, evidence, novelty, rarity — and let significance be
 *   the place size is allowed to speak.
 *
 *   OPP IS WORTH AS MUCH AS TWIN. Twin answers "who thinks like me?"; Opp answers
 *   "who consistently challenges me?" Both are discoveries. An Opp is not an
 *   enemy and is never scored as a lesser find.
 *
 *   EVIDENCE GATES THE PULL. A 100% match on three shared convictions is a
 *   coincidence, not a Twin. Thin relationships get thin discovery value, the same
 *   honesty rule the badges already enforce (src/domain/relationship).
 *
 *   FAMILIARITY IS NOT DISCOVERY. The third time the same face appears in one
 *   feed it has stopped introducing anyone. Seen-ness is counted within a single
 *   feed and decays the value — which is what keeps the network feeling broad
 *   instead of showing you your Twin nine times.
 *
 *   STRANGERS COUNT. A person with no relationship to the viewer can still be a
 *   discovery: a founding believer, someone who has held a conviction for months.
 *   Without this the feed could only ever surface people the viewer has already
 *   matched with, and the network would never widen.
 *
 * ZERO IO, pure, fully testable. Never persisted — it is different for every
 * reader and stale the moment their DNA moves.
 */
import { compose, type Significance } from "@/domain/significance";
import { NETWORK_LABEL_TEXT, NETWORK_STRENGTH, type NetworkLabel } from "@/domain/story";

/** One person an event is about, and what the viewer knows about them. */
export interface DiscoverySubject {
  wallet: string;
  /** The viewer's relationship to them, or null for a stranger. */
  relationship?: NetworkLabel | null;
  /** Shared directional convictions — the evidence behind the relationship. */
  sharedConvictions?: number | null;
  /** 0..1 from the DNA engine. */
  confidence?: number | null;
  /** Distinct topics the relationship spans. Breadth beats repetition. */
  topicCount?: number | null;
  /** When this relationship label was established (ISO). Recent == the story. */
  since?: string | null;
  /** How long they have backed the conviction this event is about. */
  daysHeld?: number | null;
  /** Present essentially since the market opened. */
  founding?: boolean | null;
  /** How many convictions they hold — is there anything to find on their profile? */
  convictions?: number | null;
}

export const DISCOVERY = {
  /**
   * What each relationship is worth as an INTRODUCTION — the app's shared
   * strength scale (src/domain/story), where the product's Opp (stored as
   * `inverse`) sits level with Twin.
   */
  pull: NETWORK_STRENGTH,
  /** Shared convictions at which a relationship's evidence is fully credited. */
  minShared: 6,
  /** A label established inside this window is itself the discovery. */
  freshWindowMs: 72 * 60 * 60_000,
  /** Appearances in ONE feed after which a person stops being an introduction. */
  familiarAfter: 2,
  /** A stranger needs a real conviction history to be worth meeting on its own. */
  strangerMinDays: 30,
  /** The most breadth (many new people at once) can add over the best subject. */
  breadthWeight: 0.25,
  bands: { none: 0.2, weak: 0.4, real: 0.65 },
} as const;

export type DiscoveryBand = "none" | "weak" | "real" | "strong";

export function discoveryBand(value: number): DiscoveryBand {
  if (value <= DISCOVERY.bands.none) return "none";
  if (value <= DISCOVERY.bands.weak) return "weak";
  if (value <= DISCOVERY.bands.real) return "real";
  return "strong";
}

export interface Discovery extends Significance {
  /** The person who makes this a discovery, when there is one. */
  lead: string | null;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : Number.isFinite(v) ? v : 0);

/**
 * How much of a relationship's claim the evidence actually supports. Both the
 * count and the engine's own confidence must hold — a high confidence on two
 * shared markets is still two shared markets.
 */
function evidenceFactor(s: DiscoverySubject): number {
  const byCount =
    s.sharedConvictions == null ? null : clamp01(s.sharedConvictions / DISCOVERY.minShared);
  const byConfidence = s.confidence == null ? null : clamp01(s.confidence);
  if (byCount == null && byConfidence == null) return 0.5; // unknown: neither claimed nor denied
  if (byCount == null) return byConfidence as number;
  if (byConfidence == null) return byCount;
  return Math.min(byCount, byConfidence);
}

/** Is this relationship new enough that meeting them IS the event? */
function isFresh(s: DiscoverySubject, nowMs: number): boolean {
  if (!s.since) return false;
  const t = Date.parse(s.since);
  return Number.isFinite(t) && nowMs - t <= DISCOVERY.freshWindowMs && nowMs - t >= 0;
}

/** What one person is worth as an introduction, and why. */
function subjectValue(
  s: DiscoverySubject,
  nowMs: number,
  seen: number,
): { value: number; why: string } {
  // Familiarity decay. Deliberately steep: a face you have already met twice in
  // this feed is not introducing you to anyone.
  const familiar = seen >= DISCOVERY.familiarAfter ? 0.35 : seen === 1 ? 0.75 : 1;

  if (s.relationship) {
    const pull = DISCOVERY.pull[s.relationship];
    const evidence = evidenceFactor(s);
    const parts: Array<{ weight: number; value: number; why?: string }> = [];
    // Breadth: a relationship spanning four topics says more than one repeated.
    if (s.topicCount != null && s.topicCount > 1)
      parts.push({ weight: 0.2, value: clamp01((s.topicCount - 1) / 3) });
    // A relationship formed in the last few days is the strongest discovery
    // there is — it is literally a person the viewer has not met yet.
    if (isFresh(s, nowMs)) parts.push({ weight: 0.55, value: 1 });
    const base = compose(pull * evidence, parts).score;
    const word = NETWORK_LABEL_TEXT[s.relationship];
    return {
      value: base * familiar,
      why: isFresh(s, nowMs) ? `new ${word}` : `your ${word}`,
    };
  }

  // A STRANGER. No relationship, so nothing personal to claim — but conviction
  // history is a reason to open a profile, and this is the only path by which
  // the feed can widen someone's network beyond who they already matched with.
  const parts: Array<{ weight: number; value: number }> = [];
  if (s.daysHeld != null && s.daysHeld > 0)
    parts.push({ weight: 0.5, value: clamp01(s.daysHeld / DISCOVERY.strangerMinDays) });
  if (s.founding) parts.push({ weight: 0.4, value: 1 });
  // Something to actually read when the profile opens.
  if (s.convictions != null && s.convictions > 0)
    parts.push({ weight: 0.25, value: clamp01(s.convictions / 10) });
  if (parts.length === 0) return { value: 0, why: "no one to meet" };
  return { value: compose(0, parts).score * familiar, why: "worth a look" };
}

export interface DiscoveryContext {
  /** How many times each wallet has already appeared EARLIER in this feed. */
  seen?: ReadonlyMap<string, number>;
  /** Injected for tests. */
  nowMs?: number;
}

/**
 * What this event is worth as an introduction. Driven by the STRONGEST subject,
 * not the count — five tribe members is one discovery, not five — plus a bounded
 * breadth term so a row that introduces several unmet people still reads as the
 * wider door it is.
 */
export function discoveryValue(
  subjects: DiscoverySubject[],
  ctx: DiscoveryContext = {},
): Discovery {
  const nowMs = ctx.nowMs ?? Date.now();
  const seen = ctx.seen ?? new Map<string, number>();
  if (subjects.length === 0) return { score: 0, reasons: [], lead: null };

  let best: { value: number; why: string; wallet: string } | null = null;
  let unmet = 0;
  for (const s of subjects) {
    const already = seen.get(s.wallet.toLowerCase()) ?? 0;
    if (already === 0) unmet += 1;
    const v = subjectValue(s, nowMs, already);
    if (!best || v.value > best.value) best = { ...v, wallet: s.wallet };
  }
  if (!best || best.value <= 0) return { score: 0, reasons: [], lead: null };

  const breadth = subjects.length > 1 ? clamp01((unmet - 1) / 4) : 0;
  const out = compose(0, [
    { weight: 1, value: best.value, why: best.why },
    ...(breadth > 0
      ? [{ weight: DISCOVERY.breadthWeight, value: breadth, why: `${unmet} new people` }]
      : []),
  ]);
  return { score: out.score, reasons: out.reasons, lead: best.wallet };
}

/**
 * Count appearances as a feed is walked, so the same person's fourth row is
 * scored as the repetition it is. Mutates the map by design — the caller owns one
 * counter for one feed, and the order rows are scored in is the order the reader
 * meets them in.
 */
export function markSeen(seen: Map<string, number>, wallets: Iterable<string>): void {
  for (const w of wallets) {
    const k = w.toLowerCase();
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
}
