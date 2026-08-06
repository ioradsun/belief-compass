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

export type FeedNetwork = "everyone" | "tribe" | "rivals" | "following";

export const NETWORK_OPTIONS: { key: FeedNetwork; label: string; blurb: string }[] = [
  { key: "everyone", label: "Everyone", blurb: "The whole board." },
  { key: "tribe", label: "My Tribe", blurb: "What people you align with are backing." },
  { key: "rivals", label: "Rivals", blurb: "Where people who disagree with you are active." },
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

const KNOWN_TOPICS = new Set(TOPIC_OPTIONS.map((t) => t.key).filter((k) => k !== "other"));
const KNOWN_NETWORKS = new Set<string>(NETWORK_OPTIONS.map((n) => n.key));

export interface FeedFilters {
  networks: FeedNetwork[];
  topics: string[];
}

export const ALL: FeedFilters = { networks: [], topics: [] };

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
  const collapsed =
    networks.length === 1 && networks[0] === "everyone" ? ([] as FeedNetwork[]) : networks;
  return { networks: collapsed.includes("everyone") ? collapsed : collapsed, topics };
}

export function isAll(f: FeedFilters): boolean {
  const n = normalize(f);
  return n.networks.length === 0 && n.topics.length === 0;
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

const labelOf = (f: FeedFilters): string[] => {
  const n = normalize(f);
  return [
    ...n.topics.map((t) => TOPIC_OPTIONS.find((o) => o.key === t)?.label ?? t),
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
  /** Followed people connected here (creator or holder). */
  followedHere: number;
}

const topicOf = (category: string | null): string => {
  const c = (category ?? "").toLowerCase().trim();
  return KNOWN_TOPICS.has(c) ? c : "other";
};

/** Does this market survive the selection? OR within a group, AND across. */
export function matches(f: FeedFilters, c: FilterCandidate): boolean {
  const n = normalize(f);
  if (n.topics.length > 0 && !n.topics.includes(topicOf(c.category))) return false;
  if (n.networks.length === 0) return true;
  return n.networks.some((k) => {
    if (k === "everyone") return true;
    if (k === "tribe") return c.tribeCount > 0;
    if (k === "rivals") return c.oppCount > 0;
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
  return `${n.networks.join("|")}#${n.topics.join("|")}`;
}
