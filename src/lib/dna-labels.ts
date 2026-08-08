/**
 * Conviction DNA — presentation labels (client-safe, pure).
 *
 * Canonical relationship truth stays server-owned; this only maps a stored label
 * to restrained display text/tone. Color reinforces hierarchy but is never the
 * only signal — every badge reads in monochrome.
 */
import type { EvidenceLevel, RelationshipLabel } from "@/domain/dna/config";

// One vocabulary across the app: Tribe/Rivals are the groups; Twin/Opp are the
// earned top tiers. The engine's mid-tier "opp" reads as a Rival; the strong
// "inverse" tier reads as the earned Opp.
export const RELATIONSHIP_TEXT: Record<RelationshipLabel, string> = {
  twin: "Twin",
  tribe: "Tribe",
  neutral: "Neutral",
  opp: "Rival",
  inverse: "Opp",
  insufficient: "—",
};

/** Restrained tone tokens (violet = aligned, rose = opposed, muted = neutral). */
export function relationshipTone(label: RelationshipLabel): { fg: string; bg: string } {
  switch (label) {
    case "twin":
    case "tribe":
      return { fg: "var(--yes)", bg: "color-mix(in oklab, var(--yes) 14%, transparent)" };
    case "opp":
    case "inverse":
      return { fg: "var(--no)", bg: "color-mix(in oklab, var(--no) 14%, transparent)" };
    default:
      return {
        fg: "var(--text-muted)",
        bg: "color-mix(in oklab, var(--text-muted) 12%, transparent)",
      };
  }
}
