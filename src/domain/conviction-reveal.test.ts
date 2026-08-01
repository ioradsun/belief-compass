import { describe, it, expect } from "vitest";
import {
  getConvictionReveal,
  EARLY_MAX,
  BELONGING_MIN,
  MAX_FACES,
  type ConvictionRevealInput,
  type RevealFace,
} from "./conviction-reveal";

const face = (n: number): RevealFace => ({
  name: `P${n}`,
  avatarUrl: null,
  wallet: `0x${n}`,
});

const base = (o: Partial<ConvictionRevealInput> = {}): ConvictionRevealInput => ({
  side: "YES",
  seed: 1,
  ...o,
});

describe("getConvictionReveal — shape discipline", () => {
  it("never returns more than two cards or a second competing button", () => {
    const s = getConvictionReveal(
      base({
        housePredicted: "YES",
        twin: face(1),
        tribe: [face(2), face(3)],
        opps: [face(4)],
        believers: 40,
        believerFaces: [face(5)],
        momentum: "accelerating",
        dnaAdvanced: true,
        creatorName: "Alex",
      }),
    );
    expect(s.cards.length).toBeLessThanOrEqual(2);
    expect(s.cta.kind).toBe("next");
  });

  it("caps faces at five and reports the overflow", () => {
    const tribe = Array.from({ length: 12 }, (_, i) => face(i));
    const s = getConvictionReveal(base({ tribe }));
    const card = s.cards.find((c) => c.type === "tribe")!;
    expect(card.faces.length).toBe(MAX_FACES);
    expect(card.overflow).toBe(12 - MAX_FACES);
  });
});

describe("The House owns the headline when it has a read", () => {
  it("a correct read leads, and shows the side underneath", () => {
    const s = getConvictionReveal(base({ side: "YES", housePredicted: "YES" }));
    expect(s.tone).toBe("house");
    expect(s.subheadline).toBe("You backed YES.");
    expect(s.headline).toMatch(/\S/);
  });
  it("defying the read celebrates the surprise, never scolds", () => {
    const s = getConvictionReveal(base({ side: "NO", housePredicted: "YES", surpriseStreak: 4 }));
    expect(s.tone).toBe("house");
    expect(s.headline.toLowerCase()).not.toMatch(/wrong|bad|fail/);
  });
  it("with no read, the headline is a warm confirmation, tinted by side", () => {
    const s = getConvictionReveal(base({ side: "NO", housePredicted: null }));
    expect(s.tone).toBe("no");
    expect(s.headline).not.toMatch(/completed|order|success/i);
  });
});

describe("Reveal hierarchy — the strongest story wins the cards", () => {
  it("a Twin outranks the crowd", () => {
    const s = getConvictionReveal(base({ twin: face(1), believers: 50, believerFaces: [face(2)] }));
    expect(s.cards[0].type).toBe("twin");
  });
  it("a Twin-changed 'new discovery' outranks a same-choice Twin", () => {
    const s = getConvictionReveal(base({ twin: face(1), twinChanged: true }));
    expect(s.cards[0].type).toBe("surprise");
  });
  it("belonging vs early are mutually exclusive by believer count", () => {
    const crowd = getConvictionReveal(base({ believers: BELONGING_MIN, believerFaces: [face(1)] }));
    expect(crowd.cards.some((c) => c.type === "belonging")).toBe(true);
    expect(crowd.cards.some((c) => c.type === "early")).toBe(false);

    const early = getConvictionReveal(base({ believers: EARLY_MAX }));
    expect(early.cards.some((c) => c.type === "early")).toBe(true);
    expect(early.cards.some((c) => c.type === "belonging")).toBe(false);
  });
  it("the very first believer gets the 'You're first' story", () => {
    const s = getConvictionReveal(base({ believers: 1, firstBeliever: true }));
    expect(s.cards[0]).toMatchObject({ type: "early", title: "You're first" });
  });
});

describe("Every reveal feels different (data-driven)", () => {
  it("picks completely different cards for different markets", () => {
    const a = getConvictionReveal(base({ housePredicted: "YES", tribe: [face(1), face(2)] }));
    const b = getConvictionReveal(base({ believers: 6, momentum: "accelerating" }));
    const c = getConvictionReveal(base({ opps: [face(3)], dnaAdvanced: true }));
    const types = (x: typeof a) => x.cards.map((k) => k.type).join(",");
    expect(new Set([types(a), types(b), types(c)]).size).toBe(3);
  });
  it("a bare position still resolves to a clean, non-empty reveal", () => {
    const s = getConvictionReveal(base({}));
    expect(s.cards.length).toBe(0);
    expect(s.headline).toMatch(/\S/);
    expect(s.cta.label).toBe("Next Question");
  });
});

describe("Copy is human, never data", () => {
  it("never prints a raw percentage or 'updated'", () => {
    const s = getConvictionReveal(base({ tribe: [face(1)], dnaAdvanced: true, believers: 4 }));
    const all = [
      s.headline,
      s.subheadline ?? "",
      ...s.cards.map((c) => `${c.title} ${c.body}`),
    ].join(" ");
    expect(all).not.toMatch(/%/);
    expect(all.toLowerCase()).not.toContain("dna updated");
    expect(all.toLowerCase()).not.toContain("similarity");
  });
  it("only offers 'Meet your Tribe' when a people-story is on screen", () => {
    const withPeople = getConvictionReveal(base({ tribe: [face(1)] }));
    expect(withPeople.secondaryCta?.kind).toBe("tribe");
    const withoutPeople = getConvictionReveal(base({ momentum: "shifted" }));
    expect(withoutPeople.secondaryCta).toBeNull();
  });
});
