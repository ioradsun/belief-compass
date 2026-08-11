/**
 * Feed eligibility — the gate, and the two very different things it says.
 *
 * A market the viewer has DECIDED ON is not "penalised", it is REMOVED. Nothing
 * that fails that test can enter the ranking pool; the only way back is an
 * explicitly labelled re-entry card, and only when something material actually
 * changed (see `reentryFor`).
 *
 * WHAT THIS GATE USED TO CONFLATE, and it was the defect that made a finite feed
 * behave like a finished one. "You told us no" and "we already showed you this"
 * were both returned as `eligible: false`, and every stage downstream treated
 * them identically — dropped, never ranked, and counted as evidence that the
 * platform had run out. Two of those reasons were not decisions at all:
 *
 *   seen_this_session   the client's per-tab record of what scrolled past.
 *                       Persisted in sessionStorage so it SURVIVES A RELOAD,
 *                       with no expiry of any kind — so reloading a tab could
 *                       only ever shrink the feed, and reloading it twice shrank
 *                       it further. A candidate pool of 240 shared markets minus
 *                       a monotonically growing exclusion set has exactly one
 *                       destination.
 *   recently_viewed     the same event, server-recorded, on an 8h cooldown. It
 *                       expires, which is right, but until it did it removed the
 *                       market as absolutely as an explicit hide.
 *
 * Neither is a statement by the reader. Scrolling past a market is the absence
 * of a decision, and the correct response to it is to ask again later — not to
 * delete the market and then report that discovery is over.
 *
 * SO THE GATE RETURNS A TIER, not a boolean.
 *
 *   fresh        never shown, never acted on. The feed's first choice, always.
 *   resurfaced   we have shown it and the reader did not decide. Available, but
 *                only once nothing fresh is left, and oldest-seen first.
 *   blocked      the reader decided, or the market is not theirs to decide on.
 *                Out, for the length of the cooldown, at every tier.
 *
 * The line between `resurfaced` and `blocked` is the whole design: THINGS THE
 * PERSON DECIDED STAY OUT, THINGS WE MERELY SHOWED THEM COME BACK. A pass, a
 * sale, a hide and an open position are decisions. A scroll is not.
 *
 * `eligible` is kept as `tier === "fresh"` so every existing caller keeps its
 * meaning: it still answers "may this go in the fresh pool", which is the only
 * question any of them were asking.
 *
 * Pure: no IO, no clock reads except the `now` passed in.
 */
import { COOLDOWNS, REENTRY } from "./config";

export type ExclusionReason =
  | "active_position"
  | "passed"
  | "passed_repeat"
  | "recently_viewed"
  | "recently_opened"
  | "sold_out"
  | "hidden"
  | "seen_this_session"
  | "queued_this_session";

/** Everything the gate knows about ONE (viewer, market) pair. */
export interface ViewerMarketState {
  /** Holds YES or NO right now. */
  activePosition?: boolean;
  /** ISO timestamps of the viewer's last interaction of each kind. */
  passedAt?: string | null;
  passCount?: number;
  viewedAt?: string | null;
  openedAt?: string | null;
  soldAt?: string | null;
  hiddenAt?: string | null;
}

/**
 * Which pool a (viewer, market) pair belongs in. See the module doc: the split
 * between `resurfaced` and `blocked` is the difference between "we showed you
 * this" and "you told us something".
 */
export type FeedTier = "fresh" | "resurfaced" | "blocked";

/**
 * The reasons that mean "shown, not decided" — the resurfaceable set.
 *
 * `recently_opened` is here and it is the borderline one, so the reasoning is
 * written down: opening a market is engagement, not a verdict. Someone who read
 * a case file and neither backed nor passed has told us they were interested and
 * nothing else. It ranks LAST within the tier (its 24h cooldown is the longest
 * of the three, and the tier orders on exactly that), so it is only ever reached
 * when the alternative is an empty feed.
 *
 * `queued_this_session` is deliberately NOT here: it is not a history signal at
 * all but a de-duplication constraint, and resurfacing a market that is already
 * sitting further down the same queue would put it on screen twice.
 */
const RESURFACEABLE: ReadonlySet<ExclusionReason> = new Set<ExclusionReason>([
  "seen_this_session",
  "recently_viewed",
  "recently_opened",
]);

export function tierFor(reason: ExclusionReason | null): FeedTier {
  if (reason == null) return "fresh";
  return RESURFACEABLE.has(reason) ? "resurfaced" : "blocked";
}

export interface EligibilityInput {
  onchainId: number;
  state: ViewerMarketState | undefined;
  /** Market ids already shown in this browsing session. */
  sessionSeen: ReadonlySet<number>;
  /** Market ids already queued later in this session. */
  sessionQueued: ReadonlySet<number>;
  /**
   * Where each session-seen market sits in the order it was seen — 0 is the one
   * shown LONGEST ago. Optional, and its absence costs only ordering: the
   * resurface tier still works, it just cannot tell two session-seen markets
   * apart and falls back to score.
   *
   * WHY A RANK AND NOT A TIMESTAMP. `seen_this_session` is the client's own
   * record and carries no clock — the wire format is an array of ids. The array
   * is already in the order they were seen, so its INDEX is the only recency
   * signal that exists, and it is enough to answer the one question the tier
   * asks: which of these did we show them furthest back.
   */
  sessionSeenRank?: ReadonlyMap<number, number>;
  now: number;
}

export interface Eligibility {
  /** `tier === "fresh"` — may this enter the fresh pool. */
  eligible: boolean;
  /** Which pool this belongs in. See `FeedTier`. */
  tier: FeedTier;
  reason: ExclusionReason | null;
  /** When the cooldown lifts (null = eligible now, or never). */
  availableAt: number | null;
  /**
   * THE RESURFACE ORDERING KEY — lower is shown sooner. Null outside the
   * `resurfaced` tier.
   *
   * Deliberately a separate field from `availableAt`, which answers a different
   * question ("when does this become FRESH again") and must keep answering it
   * honestly. For a cooldown the two happen to coincide, because a cooldown that
   * lifts sooner is a market seen longer ago. For `seen_this_session` there is no
   * cooldown to lift at all, so this is synthesised from the seen rank —
   * comparable within the tier, and never mistaken for a real expiry.
   */
  resurfaceAt: number | null;
}

const ago = (iso: string | null | undefined, now: number): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? now - t : null;
};

/** Is a timestamped interaction still inside its cooldown? */
function cooling(
  iso: string | null | undefined,
  windowMs: number | null,
  now: number,
): { active: boolean; until: number | null } {
  if (!iso) return { active: false, until: null };
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return { active: false, until: null };
  if (windowMs == null) return { active: true, until: null };
  const until = t + windowMs;
  return { active: until > now, until };
}

/**
 * Build the answer for one reason, deriving the tier from the reason itself.
 *
 * The tier is NEVER passed in at a call site. `RESURFACEABLE` is the single
 * place the "shown vs decided" line is drawn, so adding an exclusion reason
 * later cannot accidentally create a fourth policy — it lands in `blocked`
 * unless someone deliberately says otherwise.
 */
function verdict(
  reason: ExclusionReason,
  availableAt: number | null,
  resurfaceAt: number | null,
): Eligibility {
  const tier = tierFor(reason);
  return {
    eligible: false,
    tier,
    reason,
    availableAt,
    resurfaceAt: tier === "resurfaced" ? resurfaceAt : null,
  };
}

/**
 * The one eligibility decision. Order matters: the strongest signal about what
 * the person already told us wins, so the exclusion reason is always the honest
 * one (diagnostics show it verbatim).
 *
 * The DECISIONS are tested first and the SIGHTINGS last, which is the same order
 * as before and now also means the tier degrades monotonically — a market that
 * was passed is blocked even though it was obviously also seen, because the pass
 * is the stronger statement and the reason must name it.
 */
export function eligibilityFor(input: EligibilityInput): Eligibility {
  const s = input.state ?? {};
  const now = input.now;

  if (s.hiddenAt) return verdict("hidden", null, null);
  if (s.activePosition) return verdict("active_position", null, null);

  const repeat = (s.passCount ?? 0) > 1;
  const pass = cooling(s.passedAt, repeat ? COOLDOWNS.PASS_REPEAT_MS : COOLDOWNS.PASS_MS, now);
  if (pass.active) return verdict(repeat ? "passed_repeat" : "passed", pass.until, null);

  const sold = cooling(s.soldAt, COOLDOWNS.SOLD_MS, now);
  if (sold.active) return verdict("sold_out", sold.until, null);

  // From here down the reader has told us NOTHING — these are our own records of
  // what we put in front of them. Each carries the moment it becomes the least
  // objectionable thing left to show, which is what orders the resurface tier.
  const opened = cooling(s.openedAt, COOLDOWNS.OPENED_MS, now);
  if (opened.active) return verdict("recently_opened", opened.until, opened.until);

  const viewed = cooling(s.viewedAt, COOLDOWNS.VIEWED_MS, now);
  if (viewed.active) return verdict("recently_viewed", viewed.until, viewed.until);

  if (input.sessionSeen.has(input.onchainId)) {
    /**
     * No cooldown to lift and no timestamp to read — see `sessionSeenRank`. So
     * the key is synthesised at the PESSIMISTIC end of the viewed window, as
     * though the sighting had happened this instant, and tie-broken by rank.
     *
     * Pessimistic because that is what the signal actually supports. All this
     * says is "some time during this tab's life"; for a connected wallet it also
     * implies the server-side view event has not landed yet, which makes it a
     * sighting from the last few seconds rather than the last few hours. Ordering
     * it as though it were about to expire would put the market the reader just
     * scrolled past ahead of one they saw this morning — the exact inversion the
     * tier exists to avoid.
     */
    const rank = input.sessionSeenRank?.get(input.onchainId) ?? 0;
    return verdict("seen_this_session", null, now + COOLDOWNS.VIEWED_MS + rank);
  }
  if (input.sessionQueued.has(input.onchainId)) return verdict("queued_this_session", null, null);

  return { eligible: true, tier: "fresh", reason: null, availableAt: null, resurfaceAt: null };
}

/** Live signals that can justify bringing an acted-on market back. */
export interface MaterialSignals {
  acceleration?: number | null;
  newBelievers1h?: number | null;
  priceMovePct?: number | null;
  divergence?: number | null;
  tribeEntered?: boolean;
  oppEntered?: boolean;
  newMediaAt?: string | null;
  positionMovePct?: number | null;
}

export type ReentryLabel =
  | "Your position is moving"
  | "Your Tribe is joining"
  | "A Rival entered"
  | "Conviction is shifting"
  | "This market is heating up"
  | "New context added";

export interface Reentry {
  label: ReentryLabel;
  /** The verified fact behind the label. Never invented. */
  detail: string;
}

const pct = (x: number) => `${Math.round(Math.abs(x))}%`;

/**
 * Does something material justify re-showing this market? Returns the LABEL the
 * card must carry — a re-entry card is never dressed as normal discovery.
 * Returns null when nothing changed, which is the common case.
 */
export function reentryFor(
  sig: MaterialSignals,
  opts: { holdsPosition: boolean; now?: number } = { holdsPosition: false },
): Reentry | null {
  const move = Number(sig.positionMovePct ?? 0);
  if (opts.holdsPosition && Math.abs(move) >= REENTRY.MIN_PRICE_MOVE_PCT)
    return {
      label: "Your position is moving",
      detail: `Your side has moved ${pct(move)} since you backed it.`,
    };
  if (sig.tribeEntered)
    return {
      label: "Your Tribe is joining",
      detail: "Someone you match with has taken a side here.",
    };
  if (sig.oppEntered)
    return {
      label: "A Rival entered",
      detail: "Someone you consistently disagree with took a side.",
    };
  if (Number(sig.divergence ?? 0) >= REENTRY.MIN_DIVERGENCE)
    return {
      label: "Conviction is shifting",
      detail: "People and money now disagree about which side is ahead.",
    };
  if (
    Number(sig.acceleration ?? 0) >= REENTRY.MIN_ACCELERATION ||
    Number(sig.newBelievers1h ?? 0) >= REENTRY.MIN_NEW_BELIEVERS_1H
  )
    return {
      label: "This market is heating up",
      detail: `${Math.round(Number(sig.newBelievers1h ?? 0))} new believers in the last hour.`,
    };
  if (sig.newMediaAt && (ago(sig.newMediaAt, opts.now ?? Date.now()) ?? Infinity) < 86_400_000)
    return { label: "New context added", detail: "New media or context was added to this market." };
  return null;
}
