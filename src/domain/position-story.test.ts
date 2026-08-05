import { describe, it, expect } from "vitest";
import {
  positionPulse,
  positionStory,
  positionSignal,
  STORY_RANK,
  type PositionStoryInput,
} from "./position-story";

const money = (n: number) => `$${n.toFixed(2)}`;

const base = (o: Partial<PositionStoryInput> = {}): PositionStoryInput => ({
  side: "YES",
  believers: 35,
  newToday: 0,
  gainUsd: null,
  chgPct: 0,
  ...o,
});

describe("positionPulse — personal state of the conviction", () => {
  it("accelerates on a surge of new believers", () => {
    expect(positionPulse({ newToday: 6, chgPct: 2 })).toBe("Accelerating");
  });
  it("grows on a trickle", () => {
    expect(positionPulse({ newToday: 1, chgPct: 0 })).toBe("Growing");
  });
  it("is capital-led when price moves without new people", () => {
    expect(positionPulse({ newToday: 0, chgPct: 4 })).toBe("Capital-led");
  });
  it("cools when price falls and no one joins", () => {
    expect(positionPulse({ newToday: 0, chgPct: -3 })).toBe("Cooling");
  });
  it("is mixed when people arrive but price falls", () => {
    expect(positionPulse({ newToday: 4, chgPct: -3 })).toBe("Mixed Momentum");
  });
  it("is quiet when nothing moves", () => {
    expect(positionPulse({ newToday: 0, chgPct: 0 })).toBe("Quiet");
  });
});

describe("positionStory — exactly one story, by priority", () => {
  it("your Twin outranks everything", () => {
    const s = positionStory(
      base({ net: { twin: true, tribe: true }, newToday: 9, milestone: 50 }),
      money,
    );
    expect(s.kind).toBe("twin");
  });

  /**
   * On a card about your OWN position, which way they went IS the news. These
   * two used to print the same sentence, which threw away the only part a
   * reader was looking for.
   */
  it("says which way they went when it knows", () => {
    const withYou = positionStory(base({ side: "YES", net: { twin: "YES" } }), money);
    const againstYou = positionStory(base({ side: "YES", net: { twin: "NO" } }), money);
    expect(withYou.headline).toBe("Your Conviction Twin just backed YES.");
    expect(againstYou.headline).toBe("Your Conviction Twin just backed NO.");
    expect(withYou.body).toBeUndefined();
    expect(againstYou.body).toBe("Your closest match is on the other side of you.");
  });

  it("still speaks when only the movement is known", () => {
    const s = positionStory(base({ net: { twin: true } }), money);
    expect(s.headline).toBe("Your Conviction Twin just entered this market.");
  });
  it("Tribe outranks Opp and a milestone", () => {
    expect(
      positionStory(base({ net: { tribe: true, opp: true }, milestone: 50 }), money).kind,
    ).toBe("tribe");
  });
  it("Opp outranks a milestone", () => {
    expect(positionStory(base({ net: { opp: true }, milestone: 50 }), money).kind).toBe("opp");
  });
  it("a milestone outranks a believer surge", () => {
    const s = positionStory(base({ milestone: 50, newToday: 9 }), money);
    expect(s.kind).toBe("milestone");
    expect(s.headline).toBe("This market just reached 50 believers.");
  });
  it("a believer surge tells scale and movement", () => {
    const s = positionStory(base({ newToday: 6, believers: 35 }), money);
    expect(s.kind).toBe("believer_surge");
    expect(s.headline).toBe("6 people joined YES today.");
    expect(s.body).toBe("35 now back YES.");
  });
  it("says money moved without people, never 'capital-led'", () => {
    const s = positionStory(base({ newToday: 0, chgPct: 5 }), money);
    expect(s.kind).toBe("capital");
    expect(s.headline).toBe("Money is moving into YES without new believers.");
  });
  it("says a falling, quiet side is losing ground — no 'momentum' jargon", () => {
    const s = positionStory(base({ newToday: 0, chgPct: -4, believers: 40 }), money);
    expect(s.kind).toBe("momentum");
    expect(s.headline).toBe("YES is losing ground.");
    expect(s.headline).not.toMatch(/momentum/i);
  });
  it("still early when a side is barely formed", () => {
    const s = positionStory(base({ newToday: 0, chgPct: 0, believers: 8 }), money);
    expect(s.kind).toBe("early");
    expect(s.headline).toBe("Only 8 people back YES so far.");
  });
  it("never restates the money — the card shows it", () => {
    const s = positionStory(base({ believers: 200, gainUsd: 4.18 }), money);
    expect(s.kind).toBe("quiet");
    expect(s.headline).toBe("Nothing changed today — 200 still back YES.");
  });
  it("is quiet as the last resort", () => {
    expect(positionStory(base({ believers: 200, gainUsd: 0 }), money).kind).toBe("quiet");
  });
});

describe("positionSignal — urgency ranks the list", () => {
  it("a Twin card ranks above a plain-gain card", () => {
    const twin = positionSignal(base({ net: { twin: true } }), money);
    const gain = positionSignal(base({ believers: 200, gainUsd: 5 }), money);
    expect(twin.urgency).toBeGreaterThan(gain.urgency);
    expect(twin.urgency).toBe(STORY_RANK.twin);
  });
  it("carries the personal pulse alongside the story", () => {
    const sig = positionSignal(base({ newToday: 6 }), money);
    expect(sig.pulse).toBe("Accelerating");
    expect(sig.pulseTone).toBe("up");
  });
});

describe("copy discipline", () => {
  it("never uses portfolio words", () => {
    const banned = /\bshares?\b|\bunits?\b|\bwallet\b|\bholder\b|\bvolume\b|\btoken\b/i;
    const inputs: PositionStoryInput[] = [
      base({ net: { twin: true } }),
      base({ net: { tribe: true } }),
      base({ net: { opp: true } }),
      base({ milestone: 100 }),
      base({ newToday: 9 }),
      base({ newToday: 0, chgPct: 6 }),
      base({ newToday: 0, chgPct: -6, believers: 40 }),
      base({ believers: 5 }),
      base({ believers: 300, gainUsd: 12 }),
    ];
    for (const i of inputs) {
      const s = positionStory(i, money);
      expect(`${s.headline} ${s.body ?? ""}`).not.toMatch(banned);
    }
  });
});
