/**
 * TRANSITION EMIT — the dedup / anti-spam gate for putting a market transition
 * into the UNIVERSAL feed.
 *
 * The center panel shows the strongest CURRENT interpretation live. The universal
 * feed is different: a transition belongs there only when it is genuinely news —
 * Tier 1–2, NEW, PERSISTENT enough to not be a flicker, and NOT a restatement of
 * one it just showed. This pure function makes that call against a small stored
 * record per market (the `(market, fingerprint)` dedup store), returning both the
 * decision and the next record to persist.
 *
 * The rules:
 *   • FLICKER GUARD — a state must be observed on ≥ N consecutive passes AND have
 *     persisted ≥ minPersistMs before it can emit, so a read that flips away next
 *     cycle never reaches the feed.
 *   • ANTI-RESTATEMENT — once emitted, the same fingerprint stays silent until the
 *     restate cooldown elapses; a state that changes fingerprint starts a fresh
 *     episode (its own persistence clock).
 *   • TIER GATE — only Tier 1–2 transitions are feed-worthy; Tier 3 (directional)
 *     is center-only.
 *
 * ZERO IO, pure, fully testable. The server calls this per market, then writes a
 * feed event only when `emit` is true and persists `state` either way.
 */

export interface TransitionStore {
  fingerprint: string;
  /** When this episode (this fingerprint) was first observed. */
  firstSeenAt: number;
  /** The most recent observation. */
  lastSeenAt: number;
  /** When it was last EMITTED to the feed, or null if never this episode. */
  lastEmittedAt: number | null;
  /** Consecutive observations of this fingerprint. */
  seenCount: number;
}

export type EmitReason =
  | "cleared"
  | "new-episode"
  | "flicker-guard"
  | "tier-too-low"
  | "restate-cooldown"
  | "emit";

export interface EmitDecision {
  emit: boolean;
  /** The record to persist for this market (null clears it when nothing is current). */
  state: TransitionStore | null;
  reason: EmitReason;
}

export const TRANSITION_EMIT = {
  /** Consecutive observations required before a state can emit (anti-flicker). */
  minObservations: 2,
  /** …and it must have persisted at least this long (anti-flicker). */
  minPersistMs: 120_000,
  /** After emitting a fingerprint, stay silent about it for this long. */
  restateCooldownMs: 6 * 3_600_000,
  /** Only Tier 1–2 transitions are feed-worthy. */
  maxFeedTier: 2,
} as const;

export function decideTransitionEmit(input: {
  current: { fingerprint: string; tier: number } | null;
  stored: TransitionStore | null;
  nowMs: number;
  config?: Partial<typeof TRANSITION_EMIT>;
}): EmitDecision {
  const cfg = { ...TRANSITION_EMIT, ...input.config };
  const { current, stored, nowMs } = input;

  // Nothing to say → forget the market's episode. When a state returns later it
  // re-earns its place from scratch (a fresh persistence clock).
  if (!current) return { emit: false, state: null, reason: "cleared" };

  const sameEpisode = stored != null && stored.fingerprint === current.fingerprint;

  const firstSeenAt = sameEpisode ? stored!.firstSeenAt : nowMs;
  const seenCount = sameEpisode ? stored!.seenCount + 1 : 1;
  const lastEmittedAt = sameEpisode ? stored!.lastEmittedAt : null;

  const base: TransitionStore = {
    fingerprint: current.fingerprint,
    firstSeenAt,
    lastSeenAt: nowMs,
    lastEmittedAt,
    seenCount,
  };

  // Tier gate — Tier 3 never enters the universal feed, but we still track it so
  // its persistence is known if it later strengthens into the same episode.
  if (current.tier > cfg.maxFeedTier) {
    return { emit: false, state: base, reason: "tier-too-low" };
  }

  // Flicker guard — needs both enough observations and enough wall-clock time.
  const persisted = seenCount >= cfg.minObservations && nowMs - firstSeenAt >= cfg.minPersistMs;
  if (!persisted) {
    return { emit: false, state: base, reason: sameEpisode ? "flicker-guard" : "new-episode" };
  }

  // Anti-restatement — silent until the cooldown elapses since the last emit of
  // this same fingerprint.
  if (lastEmittedAt != null && nowMs - lastEmittedAt < cfg.restateCooldownMs) {
    return { emit: false, state: base, reason: "restate-cooldown" };
  }

  return { emit: true, state: { ...base, lastEmittedAt: nowMs }, reason: "emit" };
}
