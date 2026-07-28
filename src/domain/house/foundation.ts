/**
 * House Read — cold-start foundation (canonical, pure, v1). ZERO IO.
 *
 * A new user trains the House with five FREE belief choices (YES / NO / SKIP) on
 * real market cards — never a purchase, never a personality quiz. Each answer
 * contributes WEIGHTED evidence to several psychographic dimensions; no single
 * answer ever assigns a permanent label. We store the raw answer, the mapping
 * version, and the per-dimension contributions so the mapping can be revised
 * later without destroying the original data.
 *
 * The five desired POVs (moderate wording — no "almost all" / "completely" /
 * "feared" absolutism, which would measure reaction to extremity, not the
 * intended dimension). Real markets are resolved by the server; if a configured
 * one is unavailable it falls back to a feed market covering the same dimension.
 */
import { FOUNDATION_MAPPING_VERSION, type FoundationAction } from "./config";

export { FOUNDATION_MAPPING_VERSION };

export interface FoundationMapping {
  key: string;
  /** The belief prompt, for reference + fallback matching. */
  prompt: string;
  /** Primary dimension this POV is chosen to probe (drives fallback selection). */
  probes: string;
  /** Per-action weighted contributions to psychographic dimensions. */
  dimensions: Record<FoundationAction, Record<string, number>>;
}

/** SKIP always signals "this territory doesn't pull you" — a small engagement debit. */
const SKIP_DISENGAGE = (dim: string): Record<string, number> => ({ [dim]: -0.2 });

export const FOUNDATION_MAPPINGS: FoundationMapping[] = [
  {
    key: "FOUND_WALLET",
    prompt:
      "If someone finds a wallet with $500, they will probably keep the cash before returning it.",
    probes: "trust",
    dimensions: {
      YES: { interpersonalTrust: -0.55, hiddenMotiveSensitivity: 0.3, cynicalExpectation: 0.2 },
      NO: { interpersonalTrust: 0.55, prosocialExpectation: 0.3, hiddenMotiveSensitivity: -0.1 },
      SKIP: SKIP_DISENGAGE("trustEngagement"),
    },
  },
  {
    key: "MOTHERS_INSTINCT",
    prompt: "A mother’s instinct is often more reliable than a doctor’s first opinion.",
    probes: "intuition",
    dimensions: {
      YES: { intuitionTrust: 0.5, institutionalTrust: -0.3, expertiseDeference: -0.25 },
      NO: { intuitionTrust: -0.4, institutionalTrust: 0.35, expertiseDeference: 0.3 },
      SKIP: SKIP_DISENGAGE("intuitionEngagement"),
    },
  },
  {
    key: "LUCK_VS_WORK",
    prompt: "Luck and timing matter more than hard work in becoming a billionaire.",
    probes: "agency",
    dimensions: {
      YES: { agencyBelief: -0.5, luckBelief: 0.4, systemicView: 0.25 },
      NO: { agencyBelief: 0.5, luckBelief: -0.35, meritocraticView: 0.3 },
      SKIP: SKIP_DISENGAGE("agencyEngagement"),
    },
  },
  {
    key: "CURSIVE_VS_FINANCE",
    prompt: "Schools should replace cursive lessons with financial literacy.",
    probes: "disruption",
    dimensions: {
      YES: { disruptionAppetite: 0.5, traditionAttachment: -0.35, pragmatism: 0.3 },
      NO: { disruptionAppetite: -0.4, traditionAttachment: 0.45 },
      SKIP: SKIP_DISENGAGE("disruptionEngagement"),
    },
  },
  {
    key: "RESPECTED_VS_LIKED",
    prompt: "Being respected is more valuable than being liked.",
    probes: "status",
    dimensions: {
      YES: { statusOrientation: 0.5, belongingOrientation: -0.3, independenceOrientation: 0.25 },
      NO: { belongingOrientation: 0.5, statusOrientation: -0.3, warmthOrientation: 0.25 },
      SKIP: SKIP_DISENGAGE("statusEngagement"),
    },
  },
];

/** Contributions a single answer adds to the user's dimension vector. */
export function applyFoundationAnswer(
  mapping: FoundationMapping,
  action: FoundationAction,
): Record<string, number> {
  return { ...mapping.dimensions[action] };
}

/** Fold many stored answers into one dimension vector (sum of contributions). */
export function accumulateDimensions(
  contributions: Array<Record<string, number>>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of contributions) {
    for (const [k, v] of Object.entries(c)) out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

/** Per-step copy shown while the foundation is being built (index 0 = after 1st). */
export const FOUNDATION_PROGRESS_COPY = [
  "The House noticed its first tell.",
  "A pattern is beginning to form.",
  "You’re giving the House something to work with.",
  "One more move before the House takes its first shot.",
  "House Read unlocked.",
] as const;
