/**
 * PARTICIPANT SOCIAL PROOF — "do I know anyone here?"
 *
 * A participant count answers "how big?". It never answers the question a
 * person actually asks when they land on a market: is anyone I recognise in
 * this room? This module turns the raw participant list plus the viewer's
 * network into ONE ordered face row and ONE composition sentence.
 *
 * Rules, all of them deliberate:
 *   • ONE list. Tribe and rivals are not separate sections — they are simply
 *     the people who come first, because they are the ones you recognise.
 *   • The summary is composition, never absence: with nobody familiar it reads
 *     "17 participants", not "no one from your network".
 *
 * ZERO IO, pure, testable.
 */

/** How the viewer relates to a participant. Anything else is "other". */
export type ParticipantRelation = "tribe" | "rival" | "other";

export interface SocialParticipant {
  wallet: string;
  name?: string | null;
  avatarUrl?: string | null;
  relation?: ParticipantRelation;
}

/** Faces shown before we fall back to a count. */
export const MAX_PARTICIPANT_FACES = 6;

const RANK: Record<ParticipantRelation, number> = { tribe: 0, rival: 1, other: 2 };

const rel = (p: SocialParticipant): ParticipantRelation => p.relation ?? "other";

export interface ParticipantSocial {
  /** Up to MAX_PARTICIPANT_FACES people, most personally relevant first. */
  faces: SocialParticipant[];
  /** How many participants are not shown as a face. */
  overflow: number;
  /** "2 Tribe · 1 Rival · 14 Others" — or just "17 Participants". */
  summary: string;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/**
 * @param people   Participants we have identities for (any order).
 * @param total    Authoritative participant count — usually ≥ people.length.
 */
export function participantSocial(
  people: SocialParticipant[],
  total: number,
): ParticipantSocial {
  const seen = new Set<string>();
  const unique: SocialParticipant[] = [];
  for (const p of people) {
    const w = (p.wallet ?? "").toLowerCase();
    if (!w || seen.has(w)) continue;
    seen.add(w);
    unique.push(p);
  }

  // Stable within a relation tier: the caller's order carries its own meaning
  // (recency, size), so we only lift the familiar faces to the front.
  const ordered = unique
    .map((p, i) => ({ p, i }))
    .sort((a, b) => RANK[rel(a.p)] - RANK[rel(b.p)] || a.i - b.i)
    .map((x) => x.p);

  const count = Math.max(0, Math.round(total)) || ordered.length;
  const faces = ordered.slice(0, MAX_PARTICIPANT_FACES);
  const overflow = Math.max(0, count - faces.length);

  const tribe = ordered.filter((p) => rel(p) === "tribe").length;
  const rival = ordered.filter((p) => rel(p) === "rival").length;
  const others = Math.max(0, count - tribe - rival);

  const parts: string[] = [];
  if (tribe > 0) parts.push(`${tribe} Tribe`);
  if (rival > 0) parts.push(`${rival} ${plural(rival, "Rival", "Rivals")}`);
  if (parts.length > 0 && others > 0) parts.push(`${others} ${plural(others, "Other", "Others")}`);

  const summary =
    parts.length > 0
      ? parts.join(" · ")
      : count > 0
        ? `${count.toLocaleString("en-US")} ${plural(count, "Participant", "Participants")}`
        : "";

  return { faces, overflow, summary };
}

/**
 * The viewer's DNA label, reduced to the only distinction this row makes.
 * Twins are tribe; opps and inverses are rivals; everything else is "other" —
 * the row never renders an "insufficient evidence" state as a relationship.
 */
export function relationFromLabel(label?: string | null): ParticipantRelation {
  if (label === "tribe" || label === "twin") return "tribe";
  if (label === "opp" || label === "inverse") return "rival";
  return "other";
}
