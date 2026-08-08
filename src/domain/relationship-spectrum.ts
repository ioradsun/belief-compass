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
 *     at 80% over fifteen (0.39) — handing out by arithmetic the badge the rest
 *     of the model calls rare and hard-won. "4 agreements out of 4 is 100%
 *     ALIGNED on thin EVIDENCE — not a Twin."
 *   - And a genuinely earned Twin always lands at 0.52 or above, so the cut
 *     could never bind against a real one. It is a constant with no reachable
 *     effect in the direction it was written for.
 *
 * So the continuum owns three regions — with you, not yet placed, against you.
 * TWIN and OPPONENT are not bands here and are not defined anywhere else either:
 * they are withheld until production evidence supports reintroducing them through
 * the canonical classifier. The spectrum decides ORDER and COLOUR for everybody;
 * the rare word stays rare by not existing yet.
 *
 * THE COLOUR IS THE PRODUCT'S OWN LANGUAGE, not a new one. `--yes` is blue and
 * `--no` is amber, so a spectrum from deep blue through neutral to deep amber
 * says "stands where you stand" → "stands opposite you" in the vocabulary every
 * market already uses. Nothing new to learn.
 *
 * ZERO IO, pure, fully testable.
 */
import { confidenceFor } from "./dna/config";
import type { EarnedLabel, RelationshipGroup } from "./relationship";

/** A word for a region of the continuum. Never a container, never a filter. */
/**
 * TWO WORDS AND A SILENCE. `twin` and `opponent` are gone with the earned
 * layer — production has one pair that would earn Twin and none that would earn
 * Opp, and `opponent` was also the second noun for a label `dna-labels` already
 * calls "Opp". One engine label must not render as two different words.
 */
export type SpectrumBand = "tribe" | "neutral" | "rival";

export interface SpectrumInput {
  /** Conviction-weighted same-side fraction, 0–100. */
  alignmentPct: number;
  /**
   * How much this is worth believing, 0–1. Comes from the shared-evidence count
   * (src/domain/dna/config#confidenceFor) — this module never re-derives it.
   */
  confidence: number;
  /**
   * @deprecated Twin/Opp are held back; this is always null. Kept on the input
   * so callers do not all have to change on the same day.
   * Carries nothing. Formerly the evidence and
   * topic-breadth requirements a single scalar cannot express, which is why the
   * two extreme words are gated on it rather than on a cutoff. See the header.
   */
  earned?: EarnedLabel;
  /**
   * WHERE THE ENGINE PUT THEM — from `presentRelationship`, which gets it from
   * `labelFor`. The band is now this, not a cut through `position`.
   *
   * The header below argues at length against inventing a `strong` cutoff on the
   * continuum. That argument was right and did not go far enough: the OTHER two
   * cuts, at ±SPECTRUM.neutral, were inventions too, and they disagreed with the
   * engine on 92.7% of real relationships. `position` was always the honest part
   * of this module — a confidence-damped scalar for ORDER and COLOUR. It is now
   * only that.
   */
  group: RelationshipGroup;
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
} as const;
/**
 * WHAT WAS HERE. `searchAt: 20` — the list length past which the panel grew a
 * search box — and its own comment admitted it was "a guess wearing a
 * constant's clothes", unmeasurable from the client because `viewer_dna_cache`
 * is service-role only.
 *
 * It is gone with the box. Two reasons, and the second is the one that mattered:
 * the header already searches people across the whole platform through the same
 * `getNetwork(query)` call, so the panel's box was a second answer to a question
 * that had one; and the box and the spectrum filter shared the threshold, so a
 * reader with eight people got NEITHER — the filter was withheld from exactly
 * the reader whose list was short enough for it to be the only control they
 * needed. Removing the box is what let the filter be unconditional.
 */

const clamp = (v: number, lo: number, hi: number): number =>
  !Number.isFinite(v) ? lo : v < lo ? lo : v > hi ? hi : v;

/** Where this person sits, and the one number their card shows. */
export function place(input: SpectrumInput): SpectrumPlace {
  const alignment = clamp(input.alignmentPct, 0, 100);
  const confidence = clamp(input.confidence, 0, 1);
  // The whole design, in one line: distance from neutral, damped by how much we
  // actually know. Thin evidence cannot reach an extreme. ORDER and COLOUR only —
  // the word comes from the engine.
  const position = ((alignment - 50) / 50) * confidence;
  return {
    position,
    matchPct: Math.round(alignment),
    band: bandFor(input.group),
  };
}

/**
 * The word for a place on the continuum — the ENGINE'S direction, plus the
 * earned badge when one was won.
 *
 * This used to cut `position` at ±SPECTRUM.neutral and decide for itself. That
 * made it the third module classifying relationships, and the three disagreed on
 * 92.7% of real ones. A scalar cannot know a relationship spans three topics; it
 * turns out it could not reliably know the direction either, because the damping
 * that makes it a good SORT key also drags genuine relationships into the middle.
 */
export function bandFor(group: RelationshipGroup): SpectrumBand {
  if (group === "tribe") return "tribe";
  if (group === "rival") return "rival";
  return "neutral";
}

/**
 * The label a card shows. Null in the neutral band — a person we cannot place
 * gets no word rather than the word "neutral", which tells a reader nothing and
 * takes up the same room as something true.
 */
export function bandLabel(band: SpectrumBand): string | null {
  switch (band) {
    case "tribe":
      return "Tribe";
    case "rival":
      return "Rival";
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

/**
 * NOT "UNPLACED". That is what the model calls someone; it is not what they are.
 * A reader filtering their own people should see a state that is about the
 * relationship — it has not settled into a shape yet — rather than a report on
 * the classifier's confidence. The absence of a label is already the message on
 * the card; this only has to name the same absence in a way a person would.
 */
export const SPECTRUM_FILTERS: readonly { id: SpectrumFilter; label: string }[] = [
  { id: "all", label: "Everyone" },
  { id: "tribe", label: "Tribe" },
  { id: "rival", label: "Rivals" },
  { id: "neutral", label: "Still forming" },
] as const;

export function matchesFilter(band: SpectrumBand, filter: SpectrumFilter): boolean {
  return filter === "all" || band === filter;
}
