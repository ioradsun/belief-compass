/**
 * THE RELATIONSHIP SPECTRUM — one continuum, from the people who think like you
 * to the people who think the opposite.
 *
 * WHAT WAS WRONG, and it is the same failure this codebase keeps making: the
 * continuum already existed and was thrown away. `presentRelationship` computes
 * `alignmentPct`, a continuous 0–100, and then immediately collapses it into a
 * CATEGORY at hard boundaries (`tribe` above 55, `rival` below 45). Every
 * surface downstream reads the category.
 *
 * Three things follow, and all three are visible in the product:
 *
 *   1. NEIGHBOURS ARE SEPARATED AND STRANGERS ARE JOINED. Someone at 56% and
 *      someone at 44% sat in DIFFERENT TABS, twelve points apart. Someone at 56%
 *      and someone at 96% shared a tab, forty points apart. The navigation
 *      contradicted the data.
 *
 *   2. THE SAME NUMBER MEANT OPPOSITE THINGS. The Tribe list printed
 *      `alignmentPct`; the Rivals list printed `oppositionPct`. "70%" meant
 *      "agrees with you seven times in ten" on one tab and "disagrees with you
 *      seven times in ten" on the other. Two lists made that survivable. One
 *      list makes it a lie, so this module has exactly ONE number: MATCH, always
 *      from the reader's point of view, never flipped.
 *
 *   3. UNCERTAINTY LOOKED LIKE CONVICTION. Four agreements out of four is 100%
 *      aligned on almost no evidence. The old model handled this with a
 *      separate `tier` that changed what the row said. Here it is structural
 *      instead: CONFIDENCE SHRINKS YOU TOWARD THE MIDDLE.
 *
 * THAT LAST RULE IS THE WHOLE DESIGN.
 *
 *     position = ((alignment − 50) / 50) × confidence
 *
 * A person you have barely overlapped with sits near neutral — in the middle of
 * the list, in a neutral colour — however extreme their raw percentage. The
 * extremes are EARNED by evidence, not claimed by arithmetic. One rule replaces
 * a tier system and a sort comparator per group, and it makes the list's own
 * shape the honest thing: certainty at the ends, uncertainty in the middle.
 *
 * WHY THERE IS NO `strong` CUTOFF, which is the one thing to understand before
 * changing this file. The obvious design gives the continuum four cuts and reads
 * the top band as "Twin". Measured against the real confidence curve
 * (`confidenceFor` = shared / (shared + 8)) that is wrong twice over:
 *
 *   - A cut at 0.35 mints a Twin at 90% over EIGHT shared convictions (0.40) and
 *     at 80% over fifteen (0.39). `EARNED_LABELS.twin` demands 90% AND fifteen
 *     shared AND three topics. The band would be handing out, by arithmetic, the
 *     badge the rest of the model calls rare and hard-won — the exact thing
 *     `relationship.ts` says must never happen: "4 agreements out of 4 is 100%
 *     ALIGNED on thin EVIDENCE — not a Twin."
 *   - And a genuinely earned Twin always lands at 0.52 or above, so the cut
 *     could never bind against a real one. It is a constant with no reachable
 *     effect in the direction it was written for.
 *
 * So the continuum owns three regions — with you, not yet placed, against you —
 * and TWIN and OPPONENT stay what they already are: earned overlays, carrying
 * the topic-breadth and evidence requirements a single scalar cannot express.
 * The spectrum decides ORDER and COLOUR for everybody; the rare word stays rare.
 *
 * THE COLOUR IS THE PRODUCT'S OWN LANGUAGE, not a new one. `--yes` is blue and
 * `--no` is amber, so a spectrum from deep blue through neutral to deep amber
 * says "stands where you stand" → "stands opposite you" in the vocabulary every
 * market already uses. Nothing new to learn.
 *
 * ZERO IO, pure, fully testable.
 */
import { confidenceFor } from "./dna/config";
import type { EarnedLabel } from "./relationship";

/** A word for a region of the continuum. Never a container, never a filter. */
export type SpectrumBand = "twin" | "tribe" | "neutral" | "rival" | "opponent";

export interface SpectrumInput {
  /** Conviction-weighted same-side fraction, 0–100. */
  alignmentPct: number;
  /**
   * How much this is worth believing, 0–1. Comes from the shared-evidence count
   * (src/domain/dna/config#confidenceFor) — this module never re-derives it.
   */
  confidence: number;
  /**
   * The earned badge, if the relationship has one. Carries the evidence and
   * topic-breadth requirements a single scalar cannot express, which is why the
   * two extreme words are gated on it rather than on a cutoff. See the header.
   */
  earned?: EarnedLabel;
}

export interface SpectrumPlace {
  /**
   * −1 … 0 … +1. Positive is aligned, negative is opposed, and the magnitude is
   * already damped by confidence — so this is directly the sort key, the colour
   * input, and the band input. One number, three uses, no chance of them
   * disagreeing.
   */
  position: number;
  /** The ONE percentage a card shows: how often you agree. Never flipped. */
  matchPct: number;
  band: SpectrumBand;
}

/**
 * The most evidence that still says nothing. `RELATIONSHIP_LIST_MIN_SHARED` is
 * 1, so people seen exactly once ARE in this list — and a single coin flip must
 * not come with a relationship word attached, however it landed.
 */
const NEUTRAL_MAX_SHARED = 1;

export const SPECTRUM = {
  /**
   * |position| at or below this reads as neutral: no claim either way.
   *
   * DERIVED, not chosen. It is exactly the furthest a single shared conviction
   * can reach — `confidenceFor(1)`, which the curve puts at 1/9 — so the middle
   * is precisely wide enough to hold everyone the evidence cannot place, and it
   * moves with `confidenceK` instead of drifting away from it. A flat 0.1 here
   * was off by 0.011 and let a lone coin flip out of the middle calling itself
   * Tribe, which is the exact failure this module was written to end.
   */
  neutral: confidenceFor(NEUTRAL_MAX_SHARED),
  /**
   * Below this many people, a search box costs more than it saves: reading a
   * short list is faster than deciding what to type. Above it, scanning stops
   * being viable.
   *
   * TWENTY, and I could not measure the real distribution of network sizes from
   * here — `viewer_dna_cache` is service-role only. It is a guess wearing a
   * constant's clothes, and it should be checked against live data before it is
   * trusted. What is NOT a guess is the shape: the control appears because the
   * list got long, never because the page loaded.
   */
  searchAt: 20,
} as const;

const clamp = (v: number, lo: number, hi: number): number =>
  !Number.isFinite(v) ? lo : v < lo ? lo : v > hi ? hi : v;

/** Where this person sits, and the one number their card shows. */
export function place(input: SpectrumInput): SpectrumPlace {
  const alignment = clamp(input.alignmentPct, 0, 100);
  const confidence = clamp(input.confidence, 0, 1);
  // The whole design, in one line: distance from neutral, damped by how much we
  // actually know. Thin evidence cannot reach an extreme.
  const position = ((alignment - 50) / 50) * confidence;
  return {
    position,
    matchPct: Math.round(alignment),
    band: bandFor(position, input.earned ?? null),
  };
}

/**
 * The word for a place on the continuum.
 *
 * Position alone gives the three regions. The two extreme words are the earned
 * badge the model already computes — a scalar cannot know that a relationship
 * spans three topics, and inventing a cutoff that pretends it can is how the
 * rare label stops being rare. See the header.
 */
export function bandFor(position: number, earned: EarnedLabel = null): SpectrumBand {
  const p = clamp(position, -1, 1);
  if (p > SPECTRUM.neutral) return earned === "twin" ? "twin" : "tribe";
  if (p >= -SPECTRUM.neutral) return "neutral";
  return earned === "opp" ? "opponent" : "rival";
}

/**
 * The label a card shows. Null in the neutral band — a person we cannot place
 * gets no word rather than the word "neutral", which tells a reader nothing and
 * takes up the same room as something true.
 */
export function bandLabel(band: SpectrumBand): string | null {
  switch (band) {
    case "twin":
      return "Twin";
    case "tribe":
      return "Tribe";
    case "rival":
      return "Rival";
    case "opponent":
      return "Opponent";
    default:
      return null;
  }
}

/**
 * ONE ORDERING: most like you first, least like you last.
 *
 * No per-group comparator and no exposed sort control. Because `position` is
 * already confidence-damped, a 100%-on-two-convictions match cannot jump a
 * 92%-on-thirty — it sits mid-list where its evidence puts it. Ties break on
 * evidence so the more-known person leads, and then on wallet so the order is
 * stable across polls rather than shuffling under the reader.
 */
export function compareSpectrum(
  a: { position: number; sharedConvictions: number; wallet: string },
  b: { position: number; sharedConvictions: number; wallet: string },
): number {
  if (b.position !== a.position) return b.position - a.position;
  if (b.sharedConvictions !== a.sharedConvictions) return b.sharedConvictions - a.sharedConvictions;
  return a.wallet.localeCompare(b.wallet);
}

/**
 * The colour, as a CSS `color-mix` against the product's own tokens.
 *
 * Returned as a string the component drops into `style`, so the palette stays in
 * CSS where the themes are and this module stays free of hex values. A position
 * near zero is the muted text colour — visible, uncommitted, and identical in
 * both themes.
 */
export function spectrumColor(position: number): string {
  const p = clamp(position, -1, 1);
  const strength = Math.round(Math.abs(p) * 100);
  if (strength < 6) return "var(--text-muted)";
  const end = p > 0 ? "var(--yes)" : "var(--no)";
  // Never a full-strength token at the low end: the mix IS the signal, and a
  // weak relationship painted in the same blue as a strong one would say the
  // colour means "aligned" rather than "how aligned".
  return `color-mix(in oklab, ${end} ${Math.max(22, strength)}%, var(--text-muted))`;
}

/**
 * The ring around a face — the SAME continuum as the text colour, so the border
 * and the number can never tell different stories. Width grows with certainty:
 * an unplaced person gets a hairline, an earned extreme gets a real ring.
 */
export function spectrumRing(position: number): { color: string; width: number } {
  const p = clamp(position, -1, 1);
  const m = Math.abs(p);
  if (m < SPECTRUM.neutral) return { color: "var(--border-strong)", width: 1 };
  return { color: spectrumColor(p), width: m >= 0.45 ? 2.5 : 2 };
}

/** The one filter the people list exposes: which region of the continuum. */
export type SpectrumFilter = "all" | SpectrumBand;

export const SPECTRUM_FILTERS: readonly { id: SpectrumFilter; label: string }[] = [
  { id: "all", label: "Everyone" },
  { id: "twin", label: "Twins" },
  { id: "tribe", label: "Tribe" },
  { id: "neutral", label: "Unplaced" },
  { id: "rival", label: "Rivals" },
  { id: "opponent", label: "Opponents" },
] as const;

export function matchesFilter(band: SpectrumBand, filter: SpectrumFilter): boolean {
  return filter === "all" || band === filter;
}

/**
 * Does the list need a search box yet?
 *
 * The rule is about the READER's cost, not ours: with a handful of people,
 * reading every row is faster than deciding what to type, and the box is a
 * permanent tax paid for a rare need.
 */
export function needsSearch(listSize: number): boolean {
  return listSize >= SPECTRUM.searchAt;
}
