/**
 * RELATIONSHIP NARRATIVE — one pair, one owner of the story.
 *
 * The profile used to let three different components each say something about
 * the same two people: a summary sentence from the DNA scorer, a relationship
 * badge, and a hero line derived in JSX. Three voices, no hierarchy, and
 * regularly a contradiction ("You see the world similarly" over one market).
 *
 * This module is the single narrative owner. It takes counted facts and returns
 * the ONE most interesting true statement, plus at most one supporting line.
 *
 * WHAT IT MAY NOT DO. No personality, no ideology, no emotion, no worldview.
 * Every sentence must be reducible to: shared markets, sides, categories, and
 * answered calls. If it cannot be proved from the receipts printed directly
 * below the hero, it is not said.
 *
 * PRIORITY, and the order is a claim about what matters:
 *
 *   1  mutual showing up      — whether someone is there when you call beats
 *                               whether they vote like you
 *   2  one-way showing up
 *   3  cross-topic alignment  — same instinct across different questions
 *   4  domain alignment       — where the two of them click
 *   5  the exception          — explains the percentage rather than restating it
 *   6  rival                  — repeated disagreement, never antagonism
 *   7  mixed                  — "still figuring each other out"
 *   8  thin                   — counted, with "so far", and nothing inferred
 *
 * DETERMINISTIC. Same facts, same story. No rotation, no randomness, no model
 * call at render time. Narrative quality comes from choosing the right truth.
 *
 * ZERO IO, pure, fully testable.
 */
import { convictionMatch } from "./relationship";

export interface DomainRecord {
  /** Canonical shared-market domain, already title-cased for display. */
  domain: string;
  together: number;
  apart: number;
}

export interface NarrativeFacts {
  /** First name or alias. Never a wallet the reader has not seen elsewhere. */
  name: string;
  shared: number;
  together: number;
  apart: number;
  /** Per-domain split of the SAME shared markets. Optional. */
  domains?: readonly DomainRecord[];
  /** They answered a call of yours at least once. */
  theyShowed?: boolean;
  /** You answered a call of theirs at least once. */
  youShowed?: boolean;
}

export type NarrativeKind =
  | "never_met"
  | "mutual_showing_up"
  | "they_show_up"
  | "you_showed_up"
  | "cross_topic"
  | "domain_click"
  | "exception"
  | "rival"
  | "mixed"
  | "thin";

export interface Narrative {
  kind: NarrativeKind;
  /** The one sentence. Always present. */
  primary: string;
  /** At most one, and only when it adds evidence the primary did not carry. */
  supporting: string | null;
  /** together ÷ shared, or null when there is nothing to divide. */
  matchPct: number | null;
  /** "4 of 4 together" / "2 of 2 together so far". */
  evidence: string | null;
}

export const NARRATIVE = {
  /** Shared markets before a percentage stops being a coin flip with a decimal. */
  thinBelow: 3,
  /** Shared markets in ONE domain before a domain-level claim is allowed. */
  minDomainEvidence: 3,
  /** Share of a domain's shared markets that must agree to call it a click. */
  domainAgree: 0.8,
  /** …and to call a domain the exception. */
  domainDiverge: 0.5,
  /** Overall agreement that counts as "same instinct". */
  highMatch: 0.8,
  /** Overall agreement at or below which the pair is a rival pattern. */
  lowMatch: 0.35,
  /** Distinct domains before "different topics" is true rather than flattering. */
  minTopicsForCross: 2,
} as const;

const int = (v: number | undefined): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0;

const rate = (a: number, b: number): number => (b <= 0 ? 0 : a / b);

/** Domains with enough shared markets to carry a sentence, strongest first. */
function ranked(domains: readonly DomainRecord[]) {
  return domains
    .map((d) => ({ ...d, total: int(d.together) + int(d.apart) }))
    .filter((d) => d.domain.trim() && d.total >= NARRATIVE.minDomainEvidence)
    .sort((a, b) => b.total - a.total);
}

/**
 * The single best true thing about these two people.
 *
 * Returns a `never_met` narrative rather than null so the caller has one place
 * to render the transition sentence — a 0% Conviction Match over zero markets
 * is not a relationship, it is a division by nothing.
 */
export function relationshipNarrative(facts: NarrativeFacts): Narrative {
  const who = facts.name.trim() || "They";
  const shared = int(facts.shared);
  const together = int(facts.together);
  const apart = int(facts.apart);
  const matchPct = convictionMatch(together, shared, apart);
  const agree = rate(together, shared);
  const domains = ranked(facts.domains ?? []);

  if (shared === 0) {
    return {
      kind: "never_met",
      primary: "You haven't crossed paths yet.",
      supporting: null,
      matchPct: null,
      evidence: null,
    };
  }

  const thin = shared < NARRATIVE.thinBelow;
  const evidence = `${together} of ${shared} together${thin ? " so far" : ""}`;
  const out = (
    kind: NarrativeKind,
    primary: string,
    supporting: string | null = null,
  ): Narrative => ({ kind, primary, supporting, matchPct, evidence });

  /* 1 · MUTUAL SHOWING UP — the strongest story in the system. */
  if (facts.theyShowed && facts.youShowed) {
    if (agree <= NARRATIVE.lowMatch && !thin) {
      return out("mutual_showing_up", "You rarely agree. You still show up for each other.");
    }
    if (agree >= NARRATIVE.highMatch && !thin) {
      return out(
        "mutual_showing_up",
        "You tend to see things the same way — and you show up for each other.",
      );
    }
    return out("mutual_showing_up", "You show up for each other.");
  }

  /* 2 · ONE-WAY SHOWING UP. */
  if (facts.theyShowed) return out("they_show_up", `You can count on ${who}.`);
  if (facts.youShowed) return out("you_showed_up", `You've shown up for ${who}.`);

  /* 8 · THIN EVIDENCE — counted, and nothing beyond the count. */
  if (thin) {
    if (together === shared) {
      return out(
        "thin",
        shared === 1
          ? "You've crossed paths once. Same side."
          : `You've crossed paths ${word(shared)}. Same side both times.`,
      );
    }
    if (together === 0) {
      return out(
        "thin",
        shared === 1
          ? "You've crossed paths once. Opposite sides."
          : `You've crossed paths ${word(shared)}. Opposite sides both times.`,
      );
    }
    return out("thin", `You've crossed paths ${word(shared)}. One each, so far.`);
  }

  /* 5 · THE EXCEPTION — explains the number instead of repeating it. */
  if (agree >= NARRATIVE.highMatch) {
    const odd = domains.find((d) => rate(int(d.apart), d.total) >= NARRATIVE.domainDiverge);
    if (odd) {
      return out("exception", `Usually together. ${odd.domain} is the exception.`);
    }
  }

  /* 3 · CROSS-TOPIC ALIGNMENT. */
  if (agree >= NARRATIVE.highMatch) {
    const spread = domains.filter((d) => rate(int(d.together), d.total) >= NARRATIVE.domainAgree);
    if (spread.length >= NARRATIVE.minTopicsForCross) {
      return out(
        "cross_topic",
        "Different topics. Same instinct.",
        `From ${spread[0].domain} to ${spread[1].domain}, you keep landing together.`,
      );
    }
    /* 4 · DOMAIN-SPECIFIC ALIGNMENT. */
    if (spread.length === 1) {
      return out("domain_click", `${spread[0].domain} is where you two click.`);
    }
    return out(
      "cross_topic",
      together === shared
        ? "You've landed together every time you've crossed paths."
        : "Same instinct, most of the time.",
    );
  }

  /* 6 · RIVAL — repeated disagreement, never hostility. */
  if (agree <= NARRATIVE.lowMatch) {
    const clash = domains.find((d) => rate(int(d.apart), d.total) >= NARRATIVE.domainAgree);
    return out(
      "rival",
      "Same questions. Very different answers.",
      clash ? `${clash.domain} is where you clash most.` : null,
    );
  }

  /* 7 · MIXED. */
  return out("mixed", "You're still figuring each other out.");
}

const word = (n: number): string => (n === 1 ? "once" : n === 2 ? "twice" : `${n} times`);
