/**
 * DISCOVERY MOMENTS — the rarest rows in the feed: meeting someone.
 *
 * Everything else in the tape reports what happened in a market. These report
 * what happened to the viewer's NETWORK: a Twin appeared, an Opp emerged, the
 * Tribe grew. They are the payoff for taking sides, and the reason to open the
 * app when no market has moved.
 *
 * NOT A SECOND PIPELINE. There is no new table, no new writer, no cron. A moment
 * is a READ-TIME PROJECTION of state the DNA engine already computes and caches
 * (src/lib/dna/*): each cached relationship now remembers WHEN its label was set
 * and what it was before, so "you found a Twin" is simply "a twin row whose
 * label is younger than the window". The same input always yields the same
 * moments, so a poll that changes nothing re-renders nothing, and no ledger of
 * what-was-announced needs to exist.
 *
 * RARITY IS THE PRODUCT. A discovery that fires weekly is a notification; one
 * that fires when you actually find someone is an event. So:
 *   · only LABEL TRANSITIONS count — never a score drifting a point
 *   · one moment per kind, and a hard cap per feed
 *   · a group of new Tribe members is ONE story, never four
 *   · a moment lives for `windowMs` and then is simply no longer new
 *
 * TONE. An Opp is not an enemy and is never written as one — they are the
 * strongest opposing perspective, and the copy invites the viewer to go and read
 * them. Nothing here shames anyone for leaving, disagreeing, or being wrong.
 *
 * CURIOSITY, NOT EXPLANATION. Each moment states the evidence and stops. It does
 * not explain the matching engine, justify the label, or preview the profile —
 * the row's job is to raise the question, and the profile's job is to answer it.
 * The faces are the call to action.
 *
 * ZERO IO, pure, fully testable.
 */
import type { RelationshipLabel } from "@/domain/dna/config";
import type { LiveStory } from "@/domain/story";

/** A cached relationship, with the two fields that make a moment detectable. */
export interface MomentRelationship {
  wallet: string;
  name?: string | null;
  avatarUrl?: string | null;
  relationship: RelationshipLabel;
  /** ISO — when the CURRENT label was established. Absent = unknown, never new. */
  since?: string | null;
  /** The label held before this one, when it changed. */
  previous?: RelationshipLabel | null;
  agreement: number;
  sharedBeliefs: number;
  topicCount?: number;
  confidence: number;
}

export interface ViewerNetwork {
  twin: MomentRelationship[];
  tribe: MomentRelationship[];
  /** The mid-tier opposite — the product calls these Rivals. */
  opp: MomentRelationship[];
  /** The strongest opposite — the product calls these Opps. */
  inverse: MomentRelationship[];
}

export type DiscoveryMomentKind =
  | "new_twin"
  | "new_opp"
  | "new_tribe_member"
  | "opp_changed"
  | "tribe_grew";

export interface DiscoveryMoment {
  kind: DiscoveryMomentKind;
  /** Stable across re-renders: the same state always produces the same id. */
  id: string;
  /** When this became true (ISO) — the row's place in a chronological feed. */
  occurredAt: string;
  people: MomentRelationship[];
  /** The Tribe size just passed — set only for `tribe_grew`. */
  rung?: number;
  /** How rare this is, 0..1. Feeds significance; never viewer-relative twice. */
  rarity: number;
}

export const DISCOVERY_MOMENT = {
  /** How long a new relationship stays "new". Matches the live feed's window. */
  windowMs: 72 * 60 * 60_000,
  /** Evidence floor. A label the engine granted thinly is not announced. */
  minShared: 8,
  /** Tribe sizes worth remarking on. Between rungs, growth is not a story. */
  tribeRungs: [5, 10, 25, 50, 100] as const,
  /** Never more than this many discovery rows in one feed, whatever happened. */
  maxPerFeed: 2,
} as const;

/** Rarest first — this is the order they compete for the cap. */
const RARITY: Record<DiscoveryMomentKind, number> = {
  new_twin: 1,
  new_opp: 0.95,
  opp_changed: 0.8,
  tribe_grew: 0.6,
  new_tribe_member: 0.5,
};

function isNew(r: MomentRelationship, nowMs: number): boolean {
  if (!r.since) return false;
  const t = Date.parse(r.since);
  return Number.isFinite(t) && nowMs - t >= 0 && nowMs - t <= DISCOVERY_MOMENT.windowMs;
}

/** Enough shared history that naming the relationship out loud is honest. */
const proven = (r: MomentRelationship): boolean => r.sharedBeliefs >= DISCOVERY_MOMENT.minShared;

/** Newest first, then the strongest evidence — deterministic, no clock. */
function bySinceDesc(a: MomentRelationship, b: MomentRelationship): number {
  const at = a.since ? Date.parse(a.since) : 0;
  const bt = b.since ? Date.parse(b.since) : 0;
  return bt - at || b.sharedBeliefs - a.sharedBeliefs || a.wallet.localeCompare(b.wallet);
}

/**
 * Did the tribe cross a rung inside the window? Same rule as a holding cohort:
 * you must have PASSED the number recently, not merely be above it. Without this
 * a viewer with 30 tribe members would be told they crossed 25 forever.
 */
function tribeRungCrossed(total: number, newInWindow: number): number | null {
  if (newInWindow <= 0) return null;
  let hit: number | null = null;
  for (const rung of DISCOVERY_MOMENT.tribeRungs)
    if (total >= rung && total - newInWindow < rung) hit = rung;
  return hit;
}

/**
 * The discovery moments in a viewer's network right now. Pure over the cached
 * relationships — the same network always yields the same moments.
 */
export function findDiscoveryMoments(
  net: ViewerNetwork,
  opts: { nowMs?: number } = {},
): DiscoveryMoment[] {
  const nowMs = opts.nowMs ?? Date.now();
  const fresh = (rows: MomentRelationship[]) =>
    rows.filter((r) => isNew(r, nowMs) && proven(r)).sort(bySinceDesc);

  const out: DiscoveryMoment[] = [];

  // A TWIN. The rarest thing that can happen to a viewer — one row, one person,
  // even in the (vanishing) case that two arrive at once.
  const newTwin = fresh(net.twin)[0];
  if (newTwin)
    out.push({
      kind: "new_twin",
      id: `discovery:new_twin:${newTwin.wallet}`,
      occurredAt: newTwin.since as string,
      people: [newTwin],
      rarity: RARITY.new_twin,
    });

  // AN OPP. Weighted level with a Twin: the strongest opposing perspective is as
  // valuable to meet as the closest match.
  const newOpp = fresh(net.inverse)[0];
  if (newOpp) {
    // Did they displace someone? Only claim it when the record actually shows it.
    const displaced = [...net.inverse, ...net.opp, ...net.tribe].find(
      (r) => r.previous === "inverse" && r.wallet !== newOpp.wallet,
    );
    const kind = displaced ? "opp_changed" : "new_opp";
    out.push({
      kind,
      id: `discovery:${kind}:${newOpp.wallet}`,
      occurredAt: newOpp.since as string,
      // Only the person you can go and read. The one they displaced is why the
      // sentence changes, not a face to show without explaining.
      people: [newOpp],
      rarity: RARITY[kind],
    });
  }

  // THE TRIBE. The group outranks the individual, exactly as it does for
  // cohorts: several people crossing in is one story, never several.
  const newTribe = fresh(net.tribe);
  if (newTribe.length > 0) {
    const rung = tribeRungCrossed(net.tribe.length, newTribe.length);
    out.push(
      rung != null
        ? {
            kind: "tribe_grew",
            id: `discovery:tribe_grew:${rung}`,
            occurredAt: newTribe[0].since as string,
            people: newTribe,
            rung,
            rarity: RARITY.tribe_grew,
          }
        : {
            kind: "new_tribe_member",
            // Identity is the people, so the same arrivals never tell two stories.
            id: `discovery:new_tribe_member:${newTribe
              .map((r) => r.wallet)
              .sort()
              .join(",")}`,
            occurredAt: newTribe[0].since as string,
            people: newTribe,
            rarity: RARITY.new_tribe_member,
          },
    );
  }

  return out.sort((a, b) => b.rarity - a.rarity).slice(0, DISCOVERY_MOMENT.maxPerFeed);
}

/* ── Copy ─────────────────────────────────────────────────────────────────────
 * States the evidence, then stops. The faces do the inviting. */

const nameOf = (r: MomentRelationship): string => r.name?.trim() || "Someone";

/** "Jon", "Jon and Kate", "Jon, Kate, and 3 others". */
function names(people: MomentRelationship[]): string {
  const named = people.map(nameOf);
  if (named.length === 1) return named[0];
  if (named.length === 2) return `${named[0]} and ${named[1]}`;
  const rest = named.length - 2;
  return `${named[0]}, ${named[1]}, and ${rest} ${rest === 1 ? "other" : "others"}`;
}

export function tellDiscoveryMoment(m: DiscoveryMoment): LiveStory {
  const lead = m.people[0];
  switch (m.kind) {
    case "new_twin":
      return {
        category: "twin",
        headline: "NEW TWIN",
        // The evidence, not the algorithm. "Why is this person my Twin?" is a
        // question the profile answers — the row only has to make them ask it.
        body: `You and ${nameOf(lead)} have taken the same side ${lead.sharedBeliefs} times.`,
        attribution: null,
        tone: "neutral",
        personal: true,
      };
    case "new_opp":
      return {
        category: "inverse",
        headline: "YOU FOUND YOUR OPP",
        // Never an enemy. The strongest opposing perspective, worth reading.
        body: `${nameOf(lead)} has taken the other side of you ${lead.sharedBeliefs} times — the clearest challenge to how you see things.`,
        attribution: null,
        tone: "neutral",
        personal: true,
      };
    case "opp_changed":
      return {
        category: "inverse",
        headline: "YOUR OPP CHANGED",
        body: `${nameOf(lead)} now takes the other side of you more consistently than anyone.`,
        attribution: null,
        tone: "neutral",
        personal: true,
      };
    case "tribe_grew":
      return {
        category: "tribe",
        headline: "YOUR TRIBE GREW",
        // The threshold IS the story — that is why growth between rungs is silent.
        body: `${names(m.people)} took your Tribe past ${m.rung}.`,
        attribution: null,
        tone: "neutral",
        personal: true,
      };
    default:
      return {
        category: "tribe",
        headline: m.people.length > 1 ? "NEW TRIBE MEMBERS" : "NEW TRIBE MEMBER",
        body: `${names(m.people)} started seeing things the way you do.`,
        attribution: null,
        tone: "neutral",
        personal: true,
      };
  }
}
