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
  /** When that position was last traded — which pass it belongs to. */
  positionAt?: string | null;
  /** ISO timestamps of the viewer's last interaction of each kind. */
  passedAt?: string | null;
  passCount?: number;
  viewedAt?: string | null;
  openedAt?: string | null;
  soldAt?: string | null;
  hiddenAt?: string | null;
}

/**
 * Which pool a (viewer, market) pair belongs in.
 *
 * `resurfaced` is retained as a value the sequencer still understands, but the
 * gate no longer produces it: under the pass rule a market is either untouched
 * in this pass or it is out of it, and repeats arrive by ROLLING THE PASS
 * rather than by a second tier inside one.
 */
export type FeedTier = "fresh" | "blocked" | "resurfaced";

export function tierFor(reason: ExclusionReason | null): FeedTier {
  return reason == null ? "fresh" : "blocked";
}

export interface EligibilityInput {
  onchainId: number;
  state: ViewerMarketState | undefined;
  /** Market ids already shown in this browsing session. */
  sessionSeen: ReadonlySet<number>;
  /** Market ids already queued later in this session. */
  sessionQueued: ReadonlySet<number>;
  /**
   * WHEN THE CURRENT PASS BEGAN, in epoch ms. Contact older than this belongs
   * to a spent pass and stops excluding anything. Absent means "the pass has
   * always been running", i.e. every recorded contact still counts.
   */
  cycleStartedAt?: number;
  now: number;
}

export interface Eligibility {
  /** `tier === "fresh"` — may this enter the pool for the current pass. */
  eligible: boolean;
  /** Which pool this belongs in. See `FeedTier`. */
  tier: FeedTier;
  reason: ExclusionReason | null;
  /**
   * When this becomes available again. Always null now: the answer is "when the
   * pass rolls", which is an event rather than a time, and inventing a clock for
   * it would be the cooldown model coming back through the side door.
   */
  availableAt: number | null;
  /** Legacy resurface ordering key. Always null — see `FeedTier`. */
  resurfaceAt: number | null;
}

const ago = (iso: string | null | undefined, now: number): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? now - t : null;
};

/** Build the answer for one reason. Every exclusion is a blocked one. */
function verdict(reason: ExclusionReason): Eligibility {
  return { eligible: false, tier: "blocked", reason, availableAt: null, resurfaceAt: null };
}


/**
 * THE ONE ELIGIBILITY DECISION — one rule, applied to every kind of contact.
 *
 * "Did the viewer touch this market during the current pass?" If yes, it is out
 * until the pass rolls; if no, it is in. No per-reason cooldowns, no tiers, no
 * repeats offered while untouched markets remain. `hidden` is the single
 * permanent exception, because that one IS a standing instruction.
 *
 * Order still matters, but only for the LABEL: the strongest statement the
 * reader made is the reason diagnostics print.
 */
export function eligibilityFor(input: EligibilityInput): Eligibility {
  const s = input.state ?? {};
  /**
   * WHEN THE CURRENT PASS BEGAN. Everything before it belongs to a spent pass
   * and no longer excludes anything — that is what makes the feed cyclical
   * instead of monotonically shrinking. Zero (the default) means "this viewer
   * has always been in the same pass", which is the correct reading for a
   * session that has never rolled.
   */
  const since = input.cycleStartedAt ?? 0;
  /** Did this contact happen inside the current pass? */
  const inCycle = (iso: string | null | undefined): boolean => {
    if (!iso) return false;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t >= since : false;
  };

  if (s.hiddenAt) return verdict("hidden");
  // A position TAKEN in this pass is out of it. One held since before the pass
  // began is fair to offer again — the reader is being asked what they think
  // now, and their own market is a legitimate thing to be shown.
  if (s.activePosition && (s.positionAt == null || inCycle(s.positionAt)))
    return verdict("active_position");
  if (inCycle(s.passedAt)) return verdict((s.passCount ?? 0) > 1 ? "passed_repeat" : "passed");
  if (inCycle(s.soldAt)) return verdict("sold_out");
  if (inCycle(s.openedAt)) return verdict("recently_opened");
  if (inCycle(s.viewedAt)) return verdict("recently_viewed");
  // The client's own record of this pass, for sightings the server ledger has
  // not caught up with (and for viewers with no wallet, where it is the only
  // record there is).
  if (input.sessionSeen.has(input.onchainId)) return verdict("seen_this_session");
  if (input.sessionQueued.has(input.onchainId)) return verdict("queued_this_session");

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
