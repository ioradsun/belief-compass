import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  place,
  bandFor,
  bandLabel,
  compareSpectrum,
  spectrumColor,
  SPECTRUM,
} from "./relationship-spectrum";
import { confidenceFor, EARNED_LABELS } from "./dna/config";
import { presentRelationship } from "./relationship";

/**
 * A person, composed the way PRODUCTION composes one: the engine decides the
 * group, the spectrum places them inside it. Deriving the group here rather than
 * passing a chosen one is the point — these tests would otherwise assert what
 * the spectrum does with an input nobody sends it.
 */
const person = (alignmentPct: number, shared: number, earned: "twin" | "opp" | null = null) =>
  place({
    alignmentPct,
    confidence: confidenceFor(shared),
    earned,
    group: groupOf(alignmentPct, shared),
  });

const groupOf = (alignmentPct: number, shared: number) =>
  presentRelationship({
    agreement: alignmentPct,
    sharedConvictions: shared,
    together: 0,
    apart: 0,
    topicCount: 0,
  }).group;

describe("one continuum, not two tabs", () => {
  /**
   * The defect the redesign exists to fix: 56% and 44% lived in different tabs
   * twelve points apart, while 56% and 96% shared one, forty points apart.
   */
  it("puts neighbours next to each other and strangers far apart", () => {
    const near = person(56, 20).position;
    const alsoNear = person(44, 20).position;
    const far = person(96, 20).position;
    expect(Math.abs(near - alsoNear)).toBeLessThan(Math.abs(near - far));
  });

  it("orders everyone by one key, aligned first", () => {
    const people = [person(20, 20), person(96, 20), person(50, 20), person(70, 20)];
    const sorted = [...people]
      .map((p, i) => ({ ...p, sharedConvictions: 20, wallet: `0x${i}` }))
      .sort(compareSpectrum);
    expect(sorted.map((p) => p.matchPct)).toEqual([96, 70, 50, 20]);
  });
});

describe("the one number is MATCH, never flipped", () => {
  /**
   * The Tribe list printed alignment and the Rivals list printed opposition, so
   * "70%" meant opposite things depending on which tab you were on. In one list
   * that is a lie, so an opposed person's card still shows how often you AGREE.
   */
  it("shows how often you agree, even for the most opposed person", () => {
    expect(person(8, 30, "opp").matchPct).toBe(8);
    expect(person(8, 30, "opp").matchPct).not.toBe(92);
  });

  it("rounds rather than inventing precision, and never leaves 0–100", () => {
    expect(person(87.4, 20).matchPct).toBe(87);
    expect(place({ alignmentPct: 140, confidence: 1, group: "tribe" }).matchPct).toBe(100);
    expect(place({ alignmentPct: -20, confidence: 1, group: "rival" }).matchPct).toBe(0);
  });
});

describe("confidence shrinks you toward the middle", () => {
  /**
   * THE WHOLE DESIGN. A perfect score on almost no evidence is not a strong
   * relationship, and the list's own shape has to say so.
   */
  it("cannot let a perfect score on thin evidence outrank a proven one", () => {
    const thin = person(100, 2);
    const proven = person(92, 30);
    expect(thin.position).toBeLessThan(proven.position);
  });

  it("leaves a person seen once in the neutral middle, however extreme the raw %", () => {
    expect(person(100, 1).band).toBe("neutral");
    expect(person(0, 1).band).toBe("neutral");
    expect(Math.abs(person(100, 1).position)).toBeLessThanOrEqual(SPECTRUM.neutral);
  });

  it("moves the same person outward as the evidence accumulates", () => {
    const growth = [1, 3, 8, 20, 50].map((n) => person(90, n).position);
    for (let i = 1; i < growth.length; i++) expect(growth[i]).toBeGreaterThan(growth[i - 1]);
  });

  it("places a split relationship at dead centre no matter how well known", () => {
    expect(person(50, 100).position).toBe(0);
    expect(person(50, 100).band).toBe("neutral");
  });
});

describe("the rare words stay earned", () => {
  /**
   * A cutoff on position alone hands out "Twin" at 90%-over-8-shared and at
   * 80%-over-15, while EARNED_LABELS.twin demands 90% AND 15 shared AND three
   * topics. This is the regression guard for that: strong-but-unearned reads
   * "Tribe", and no arithmetic can promote it.
   */
  it("does not mint a Twin from alignment and evidence alone", () => {
    expect(person(90, 8).band).toBe("tribe");
    expect(person(80, 15).band).toBe("tribe");
    expect(person(100, 60).band).toBe("tribe");
  });

  it("does not mint an Opponent from alignment and evidence alone", () => {
    expect(person(10, 8).band).toBe("rival");
    expect(person(0, 60).band).toBe("rival");
  });

  it("uses the earned badge the model already computes", () => {
    expect(person(EARNED_LABELS.twin.minStrength, EARNED_LABELS.twin.minShared, "twin").band).toBe(
      "twin",
    );
    expect(
      person(100 - EARNED_LABELS.opp.minStrength, EARNED_LABELS.opp.minShared, "opp").band,
    ).toBe("opponent");
  });

  /**
   * The badge names a direction as well as a strength. An "opp" badge attached
   * to an aligned position must not print "Opponent" over a positive match.
   */
  it("never lets a badge contradict the side the engine put them on", () => {
    expect(bandFor("tribe", "opp")).toBe("tribe");
    expect(bandFor("rival", "twin")).toBe("rival");
    expect(bandFor("neutral", "twin")).toBe("neutral");
    expect(bandFor("insufficient", "twin")).toBe("neutral");
  });
});

describe("a person we cannot place gets no word", () => {
  it("says nothing rather than saying 'neutral'", () => {
    expect(bandLabel("neutral")).toBeNull();
  });

  it("names every band it can name", () => {
    expect(bandLabel("twin")).toBe("Twin");
    expect(bandLabel("tribe")).toBe("Tribe");
    expect(bandLabel("rival")).toBe("Rival");
    expect(bandLabel("opponent")).toBe("Opponent");
  });
});

describe("the ordering is stable under a re-poll", () => {
  it("breaks ties on evidence, then on wallet", () => {
    const tie = (sharedConvictions: number, wallet: string) => ({
      position: 0.4,
      sharedConvictions,
      wallet,
    });
    expect([tie(4, "0xb"), tie(9, "0xa")].sort(compareSpectrum)[0].sharedConvictions).toBe(9);
    expect([tie(4, "0xb"), tie(4, "0xa")].sort(compareSpectrum)[0].wallet).toBe("0xa");
  });

  it("produces the same order from a shuffled input", () => {
    const rows = ["0xa", "0xb", "0xc", "0xd"].map((wallet, i) => ({
      position: 0.4,
      sharedConvictions: 4 + (i % 2),
      wallet,
    }));
    const once = [...rows].sort(compareSpectrum).map((r) => r.wallet);
    const twice = [...rows]
      .reverse()
      .sort(compareSpectrum)
      .map((r) => r.wallet);
    expect(twice).toEqual(once);
  });
});

describe("the colour is the product's own language", () => {
  it("commits to blue only when aligned and amber only when opposed", () => {
    expect(spectrumColor(0.7)).toContain("var(--yes)");
    expect(spectrumColor(-0.7)).toContain("var(--no)");
  });

  it("stays neutral for anyone the evidence cannot place", () => {
    expect(spectrumColor(person(100, 1).position)).toContain("var(--text-muted)");
    expect(spectrumColor(0)).toBe("var(--text-muted)");
  });

  /**
   * The mix IS the signal. If a weak relationship were painted the same blue as
   * a strong one, the colour would mean "aligned" rather than "how aligned".
   */
  it("deepens monotonically with the strength of the relationship", () => {
    const strengths = [0.15, 0.3, 0.6, 0.95].map((p) =>
      Number(/(\d+)%/.exec(spectrumColor(p))?.[1] ?? 0),
    );
    for (let i = 1; i < strengths.length; i++)
      expect(strengths[i]).toBeGreaterThan(strengths[i - 1]);
    expect(strengths.at(-1)).toBeLessThanOrEqual(100);
  });

  it("uses no hex values — the palette stays in CSS where the themes are", () => {
    for (const p of [-1, -0.5, 0, 0.5, 1]) expect(spectrumColor(p)).not.toMatch(/#[0-9a-f]/i);
  });
});

/**
 * THE PANEL HAS ONE CONTROL, AND IT IS ALWAYS THERE.
 *
 * `needsSearch(listSize)` and `SPECTRUM.searchAt` are gone with the search box
 * they gated. The box duplicated the header's people search — the same
 * `getNetwork(query)` call — and, because the spectrum filter shared its
 * threshold, a reader with fewer than twenty people was shown NEITHER control.
 */
describe("the list exposes no search", () => {
  it("keeps no list-length threshold to gate a control on", () => {
    expect(SPECTRUM).not.toHaveProperty("searchAt");
  });

  it("is not what the panel imports", () => {
    // Comments stripped: the panel EXPLAINS what it removed and why.
    const panel = readFileSync(join(process.cwd(), "src/components/NetworkPanel.tsx"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(panel).not.toMatch(/needsSearch/);
    // The one control, mounted unconditionally rather than behind a size gate.
    expect(panel).toMatch(/<SpectrumFilterControl value=\{filter\}/);
    expect(panel).not.toMatch(/placeholder="Search people/);
  });
});
