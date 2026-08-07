/**
 * FEED FILTERS — the reader builds their own lens.
 *
 * The old picker offered three mutually exclusive perspectives (For You /
 * Tribe / Rivals). A reader who wanted "AI, but only what my tribe is in" had
 * no way to say it, and a reader who wanted two topics had no way to say that
 * either. This module is the whole grammar, and it is deliberately tiny:
 *
 *   WITHIN a group   → OR   (AI + Crypto = either)
 *   ACROSS groups    → AND  (My Tribe + AI = AI markets my tribe is in)
 *
 * "All" is not an option that gets stored — it IS the empty selection. That
 * keeps one truth about the default: no filters means the feed behaves exactly
 * as it always has, and there is no second code path where "everyone" has to
 * mean the same thing as "nothing chosen".
 *
 * Pure and zero-IO: the server filters with it, the client titles with it, and
 * they can never disagree about what a selection means.
 */
import { MOMENTUM_LENSES, MOMENTUM_LABELS, type MomentumLens } from "./momentum";

export type FeedNetwork = "everyone" | "mine" | "tribe" | "rivals" | "following";

export const NETWORK_OPTIONS: { key: FeedNetwork; label: string; blurb: string }[] = [
  { key: "everyone", label: "Everyone", blurb: "The whole board." },
  /**
   * The one gap the review found in Focus. `viewer-stake` already knows what
   * created and holding mean, and the feed row already carries the author and
   * the viewer's positions — so this needed wiring, not building.
   */
  { key: "mine", label: "Mine", blurb: "Questions you asked, or have money on." },
  /**
   * THE SAME WORDS THE PEOPLE TAB USES, and they mean the same thing.
   *
   * These read "My Tribe" and "Rivals" while the People list called the same
   * people "Tribe" and "Rival" (`bandLabel`) — two vocabularies for one
   * relationship, one tab apart. `check` below holds them together.
   *
   * WHERE ARE TWIN AND OPPONENT? Inside these. The spectrum does not have four
   * peer levels: `bandFor` returns "twin" only when the relationship ALSO
   * carries the earned badge, and "tribe" for everyone else on the same positive
   * side — so twin ⊆ tribe and opponent ⊆ rival BY CONSTRUCTION. Narrowing to
   * Tribe already includes your Twins.
   *
   * Offering them as separate choices would also mean offering choices that are
   * empty for almost everyone: `EARNED_LABELS.twin` demands 90% agreement across
   * FIFTEEN shared convictions in three topics, on a platform whose busiest
   * market has 37 participants. And the feed could not honour them anyway — the
   * DNA overlay deliberately collapses `closest ∪ tribe` into one aligned bucket
   * and `inverse ∪ opp` into one opposed bucket, so `tribe_count` / `opp_count`
   * are the only per-market relationship figures that exist.
   *
   * `neutral` is not here either, and should not be: it is the band for people
   * the evidence CANNOT place. Narrowing markets by them is narrowing by noise.
   */
  { key: "tribe", label: "Tribe", blurb: "Markets people you align with created or traded." },
  {
    key: "rivals",
    label: "Rivals",
    blurb: "Markets people who disagree with you created or traded.",
  },
  { key: "following", label: "Following", blurb: "People you chose to follow." },
];

/** Topic keys, matching the POV category slugs the read-model stores. */
export const TOPIC_OPTIONS: { key: string; label: string }[] = [
  { key: "ai", label: "AI" },
  { key: "crypto", label: "Crypto" },
  { key: "defi", label: "DeFi" },
  { key: "culture", label: "Culture" },
  { key: "politics", label: "Politics" },
  { key: "sports", label: "Sports" },
  { key: "other", label: "Other" },
];

/**
 * MOMENTUM — the third dimension, and the one the grammar was missing.
 *
 * People and topics answer "who" and "what about". Neither can answer "what is
 * CHANGING", which is the question a reader asks most often and the one the feed
 * had no way to be asked. Same grammar as the other two: OR within, AND across,
 * so "Crypto + Moving now + My Tribe" is one selection rather than three
 * unrelated modes.
 *
 * The keys are `MomentumLens` values — this list exists so the filter never
 * offers a lens the classifier cannot produce.
 */
export const MOMENTUM_OPTIONS: { key: MomentumLens; label: string }[] = MOMENTUM_LENSES.map(
  (key) => ({ key, label: MOMENTUM_LABELS[key] }),
);

const KNOWN_TOPICS = new Set(TOPIC_OPTIONS.map((t) => t.key).filter((k) => k !== "other"));
const KNOWN_NETWORKS = new Set<string>(NETWORK_OPTIONS.map((n) => n.key));
const KNOWN_MOMENTUM = new Set<string>(MOMENTUM_LENSES);

export interface FeedFilters {
  networks: FeedNetwork[];
  topics: string[];
  /**
   * Momentum lenses. Empty (or absent) means "however it is moving, or not at
   * all". OPTIONAL so a saved link or a client that predates this dimension
   * still parses into a valid selection instead of failing — `normalize` always
   * returns it populated.
   */
  momentum?: MomentumLens[];
}

export const ALL: FeedFilters = { networks: [], topics: [], momentum: [] };

/**
 * Canonical form. "Everyone" alone says nothing the empty set does not already
 * say, so it collapses — otherwise the title would read "Everyone" while the
 * feed was identical to All.
 */
export function normalize(f: FeedFilters): FeedFilters {
  const networks = NETWORK_OPTIONS.map((n) => n.key).filter(
    (k) => f.networks.includes(k) && KNOWN_NETWORKS.has(k),
  );
  const topics = TOPIC_OPTIONS.map((t) => t.key).filter((k) => f.topics.includes(k));
  // Tolerate a caller that predates the momentum dimension rather than throwing:
  // a saved link or an older client sends two groups, and the third is empty.
  const momentum = MOMENTUM_LENSES.filter(
    (k) => (f.momentum ?? []).includes(k) && KNOWN_MOMENTUM.has(k),
  );
  const collapsed =
    networks.length === 1 && networks[0] === "everyone" ? ([] as FeedNetwork[]) : networks;
  return { networks: collapsed, topics, momentum };
}

export function isAll(f: FeedFilters): boolean {
  const n = normalize(f);
  return n.networks.length === 0 && n.topics.length === 0 && (n.momentum ?? []).length === 0;
}

/** Flip one option on or off, always returning a canonical selection. */
export function toggleNetwork(f: FeedFilters, key: FeedNetwork): FeedFilters {
  const has = f.networks.includes(key);
  return normalize({
    ...f,
    networks: has ? f.networks.filter((n) => n !== key) : [...f.networks, key],
  });
}

export function toggleTopic(f: FeedFilters, key: string): FeedFilters {
  const has = f.topics.includes(key);
  return normalize({ ...f, topics: has ? f.topics.filter((t) => t !== key) : [...f.topics, key] });
}

export function toggleMomentum(f: FeedFilters, key: MomentumLens): FeedFilters {
  const cur = f.momentum ?? [];
  const has = cur.includes(key);
  return normalize({ ...f, momentum: has ? cur.filter((m) => m !== key) : [...cur, key] });
}

const labelOf = (f: FeedFilters): string[] => {
  const n = normalize(f);
  return [
    ...n.topics.map((t) => TOPIC_OPTIONS.find((o) => o.key === t)?.label ?? t),
    ...(n.momentum ?? []).map((m) => MOMENTUM_LABELS[m]),
    ...n.networks
      .filter((k) => k !== "everyone")
      .map((k) => NETWORK_OPTIONS.find((o) => o.key === k)?.label ?? k),
  ];
};

/**
 * What the dropdown says about itself. Short by construction: past two
 * selections a count is more honest than a title that wraps.
 */
export function filterTitle(f: FeedFilters): string {
  const parts = labelOf(f);
  if (parts.length === 0) return "All";
  if (parts.length <= 2) return parts.join(" + ");
  return `${parts.length} Filters`;
}

/** One market, as the filter needs to judge it. */
export interface FilterCandidate {
  category: string | null;
  /** People the viewer aligns with holding a side here. */
  tribeCount: number;
  /** People the viewer is opposed to holding a side here. */
  oppCount: number;
  /**
   * Did anyone from that group CREATE or trade this market, side or not?
   *
   * Holding a side is a stricter thing than having been here, and the network
   * filter asks the looser question: "show me where my people have been".
   * A rival who wrote the question, or a tribesman who has since sold out, is
   * still a reason the market belongs in that lens — the face piles stay
   * about live conviction and are unaffected.
   */
  tribeTouched?: boolean;
  oppTouched?: boolean;
  /** Followed people connected here (creator or holder). */
  followedHere: number;
  /** Every momentum lens this market belongs in — see @/domain/feed/momentum. */
  momentum?: readonly MomentumLens[];
  /** The viewer created this market or holds a side in it — see viewer-stake. */
  mine?: boolean;
}

const topicOf = (category: string | null): string => {
  const c = (category ?? "").toLowerCase().trim();
  return KNOWN_TOPICS.has(c) ? c : "other";
};

/** Does this market survive the selection? OR within a group, AND across. */
export function matches(f: FeedFilters, c: FilterCandidate): boolean {
  const n = normalize(f);
  if (n.topics.length > 0 && !n.topics.includes(topicOf(c.category))) return false;
  // OR within the group: "Biggest gains + Waking up" is either, not both.
  const wantMomentum = n.momentum ?? [];
  if (wantMomentum.length > 0) {
    const mine = c.momentum ?? [];
    if (!wantMomentum.some((m) => mine.includes(m))) return false;
  }
  if (n.networks.length === 0) return true;
  return n.networks.some((k) => {
    if (k === "everyone") return true;
    if (k === "mine") return c.mine === true;
    if (k === "tribe") return c.tribeCount > 0 || c.tribeTouched === true;
    if (k === "rivals") return c.oppCount > 0 || c.oppTouched === true;
    return c.followedHere > 0;
  });
}

/**
 * A selection is also an ordering hint. One network chosen and nothing else
 * means the reader asked for that perspective, so the existing Tribe / Rivals
 * rankings apply; anything else is a blend and keeps the ranker's own order.
 */
export function orderingMode(f: FeedFilters): "for_you" | "tribe" | "rivals" {
  const n = normalize(f);
  if (n.networks.length !== 1) return "for_you";
  return n.networks[0] === "tribe" ? "tribe" : n.networks[0] === "rivals" ? "rivals" : "for_you";
}

/** Stable key for caching — the same selection must always produce the same key. */
export function filterKey(f: FeedFilters): string {
  const n = normalize(f);
  return `${n.networks.join("|")}#${n.topics.join("|")}#${(n.momentum ?? []).join("|")}`;
}
