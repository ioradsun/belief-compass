/**
 * Feed eligibility — the HARD gate.
 *
 * A market the viewer has already acted on is not "penalised", it is REMOVED.
 * Nothing that fails this gate can ever enter the ranking pool. The only way an
 * acted-on market comes back is as an explicitly labelled re-entry card, and
 * only when something material actually changed (see `reentryFor`).
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

export interface EligibilityInput {
  onchainId: number;
  state: ViewerMarketState | undefined;
  /** Market ids already shown in this browsing session. */
  sessionSeen: ReadonlySet<number>;
  /** Market ids already queued later in this session. */
  sessionQueued: ReadonlySet<number>;
  now: number;
}

export interface Eligibility {
  eligible: boolean;
  reason: ExclusionReason | null;
  /** When the cooldown lifts (null = eligible now, or never). */
  availableAt: number | null;
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
 * The one eligibility decision. Order matters: the strongest signal about what
 * the person already told us wins, so the exclusion reason is always the honest
 * one (diagnostics show it verbatim).
 */
export function eligibilityFor(input: EligibilityInput): Eligibility {
  const s = input.state ?? {};
  const now = input.now;

  if (s.hiddenAt) return { eligible: false, reason: "hidden", availableAt: null };
  if (s.activePosition) return { eligible: false, reason: "active_position", availableAt: null };

  const repeat = (s.passCount ?? 0) > 1;
  const pass = cooling(s.passedAt, repeat ? COOLDOWNS.PASS_REPEAT_MS : COOLDOWNS.PASS_MS, now);
  if (pass.active)
    return {
      eligible: false,
      reason: repeat ? "passed_repeat" : "passed",
      availableAt: pass.until,
    };

  const sold = cooling(s.soldAt, COOLDOWNS.SOLD_MS, now);
  if (sold.active) return { eligible: false, reason: "sold_out", availableAt: sold.until };

  const opened = cooling(s.openedAt, COOLDOWNS.OPENED_MS, now);
  if (opened.active)
    return { eligible: false, reason: "recently_opened", availableAt: opened.until };

  const viewed = cooling(s.viewedAt, COOLDOWNS.VIEWED_MS, now);
  if (viewed.active)
    return { eligible: false, reason: "recently_viewed", availableAt: viewed.until };

  if (input.sessionSeen.has(input.onchainId))
    return { eligible: false, reason: "seen_this_session", availableAt: null };
  if (input.sessionQueued.has(input.onchainId))
    return { eligible: false, reason: "queued_this_session", availableAt: null };

  return { eligible: true, reason: null, availableAt: null };
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
