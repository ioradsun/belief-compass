import { describe, it, expect } from "vitest";
import { emitStoryEvent, type StoryEventInput, type SideWindow } from "./story-event";

const side = (over: Partial<SideWindow> = {}): SideWindow => ({
  believerDelta: 0,
  believerBase: 20,
  capitalDeltaUsd: 0,
  capitalBaseUsd: 500,
  pricePct: 0,
  ...over,
});

const input = (over: Partial<StoryEventInput>): StoryEventInput => ({
  timeframeShort: "1D",
  yes: side(),
  no: side(),
  ...over,
});

describe("contradictions carry the most information", () => {
  it("believers up, capital down → people/capital divergence", () => {
    // −$120 on a $500 base clears both the absolute and the 15%-relative bar.
    const t = emitStoryEvent(input({ yes: side({ believerDelta: 4, capitalDeltaUsd: -120 }) }));
    expect(t?.type).toBe("people_capital_divergence");
    expect(t?.side).toBe("YES");
    expect(t?.headline).toBe("More believers. Less capital.");
    expect(t?.detail).toBe("4 people joined while $120.00 left the market.");
    expect(t?.tier).toBe(1);
  });

  it("capital up sharply, believers flat → concentration rising", () => {
    const t = emitStoryEvent(input({ yes: side({ believerDelta: 0, capitalDeltaUsd: 300 }) }));
    expect(t?.type).toBe("concentration_rising");
    expect(t?.headline).toBe("Capital is concentrating on YES.");
    expect(t?.detail).toBe("YES gained $300.00 without adding new believers.");
  });

  it("price up, believers and capital flat → price without conviction", () => {
    const t = emitStoryEvent(
      input({ yes: side({ believerDelta: 0, capitalDeltaUsd: 0, pricePct: 12 }) }),
    );
    expect(t?.type).toBe("price_conviction_divergence");
    expect(t?.headline).toBe("Price moved, but conviction did not.");
  });

  it("believers and capital rising together → participation broadening", () => {
    const t = emitStoryEvent(input({ yes: side({ believerDelta: 4, capitalDeltaUsd: 200 }) }));
    expect(t?.type).toBe("participation_broadening");
    expect(t?.headline).toBe("Participation is broadening.");
  });
});

describe("capital safeguards — no drama from noise", () => {
  it("ignores a capital move below the absolute floor (tiny market)", () => {
    // −$10 is under the $25 floor even though it's a big fraction of a $30 book.
    const t = emitStoryEvent(
      input({ yes: side({ believerDelta: 4, capitalDeltaUsd: -10, capitalBaseUsd: 30 }) }),
    );
    expect(t?.type).not.toBe("people_capital_divergence");
  });

  it("ignores a capital move that is normal noise in a huge market", () => {
    // −$120 absolute, but only 2.4% of a $5000 book → below the relative bar.
    const t = emitStoryEvent(
      input({ yes: side({ believerDelta: 4, capitalDeltaUsd: -120, capitalBaseUsd: 5000 }) }),
    );
    expect(t?.type).not.toBe("people_capital_divergence");
  });

  it("makes no capital claim when the delta is unavailable (0)", () => {
    const t = emitStoryEvent(input({ yes: side({ believerDelta: 4, capitalDeltaUsd: 0 }) }));
    expect(t?.type).not.toBe("people_capital_divergence");
    expect(t?.type).not.toBe("concentration_rising");
  });
});

describe("structural and social states", () => {
  it("both sides gaining similarly → the market is dividing", () => {
    const t = emitStoryEvent(
      input({
        yes: side({ believerDelta: 4, capitalDeltaUsd: 50 }),
        no: side({ believerDelta: 4, capitalDeltaUsd: 50 }),
      }),
    );
    expect(t?.type).toBe("market_dividing");
    expect(t?.side).toBeUndefined();
  });

  it("a Tribe cluster joining YES → a Tribe is forming", () => {
    const t = emitStoryEvent(input({ social: { tribeJoinedYes: 4, tribeJoinedNo: 0 } }));
    expect(t?.type).toBe("tribe_forming");
    expect(t?.side).toBe("YES");
    expect(t?.headline).toBe("A Tribe is forming around YES.");
  });

  it("a side shedding believers → losing conviction", () => {
    const t = emitStoryEvent(input({ no: side({ believerDelta: -5 }) }));
    expect(t?.type).toBe("losing_conviction");
    expect(t?.side).toBe("NO");
  });
});

describe("acceleration needs a trustworthy baseline", () => {
  const accelInput = (recent: number, prev?: { type: "accelerating"; side: "YES" }) =>
    input({
      yes: side({ believerDelta: 5, capitalDeltaUsd: recent, recentCapitalUsd: recent }),
      baseline: { normalCapitalUsd: 50 },
      prev,
    });

  it("fires when flow is well above normal", () => {
    const t = emitStoryEvent(accelInput(200)); // 4×
    expect(t?.type).toBe("accelerating");
    expect(t?.detail).toContain("× normal");
  });

  it("makes NO acceleration claim without a baseline", () => {
    const t = emitStoryEvent(
      input({ yes: side({ believerDelta: 5, capitalDeltaUsd: 200, recentCapitalUsd: 200 }) }),
    );
    expect(t?.type).not.toBe("accelerating");
  });

  it("uses the ranker's acceleration multiple, attributed to the gaining side", () => {
    const t = emitStoryEvent(
      input({
        yes: side({ believerDelta: 5, capitalDeltaUsd: 300 }),
        no: side({ capitalDeltaUsd: 10 }),
        baseline: { accelerationMultiple: 4 },
      }),
    );
    expect(t?.type).toBe("accelerating");
    expect(t?.side).toBe("YES");
    expect(t?.detail).toBe("Flow is 4.0× normal.");
  });

  it("makes no acceleration claim from the multiple when no side is gaining capital", () => {
    const t = emitStoryEvent(
      input({
        yes: side({ believerDelta: 0, capitalDeltaUsd: -5 }),
        no: side({ capitalDeltaUsd: -5 }),
        baseline: { accelerationMultiple: 5 },
      }),
    );
    expect(t?.type).not.toBe("accelerating");
  });

  it("hysteresis on the multiple: below 3× only holds if already accelerating", () => {
    const below = input({
      yes: side({ believerDelta: 3, capitalDeltaUsd: 100 }),
      baseline: { accelerationMultiple: 2.5 },
    });
    expect(emitStoryEvent(below)?.type).not.toBe("accelerating");
    expect(emitStoryEvent({ ...below, prev: { type: "accelerating", side: "YES" } })?.type).toBe(
      "accelerating",
    );
  });

  it("hysteresis: enters at 3×, holds until below 2×", () => {
    // 2.6× — below the enter bar, so a fresh read does NOT accelerate…
    expect(emitStoryEvent(accelInput(130))?.type).not.toBe("accelerating");
    // …but if we were already accelerating, it stays until it drops under 2×.
    expect(emitStoryEvent(accelInput(130, { type: "accelerating", side: "YES" }))?.type).toBe(
      "accelerating",
    );
    // Below 2× it exits even when previously accelerating.
    expect(emitStoryEvent(accelInput(90, { type: "accelerating", side: "YES" }))?.type).not.toBe(
      "accelerating",
    );
  });
});

describe("priority, dedup, and calm", () => {
  it("prefers a contradiction over a simultaneous dividing market", () => {
    // Both sides gaining believers (dividing) AND YES shows people-up/capital-down.
    // The contradiction is more informative, so it wins.
    const t = emitStoryEvent(
      input({
        yes: side({ believerDelta: 4, capitalDeltaUsd: -120 }),
        no: side({ believerDelta: 4, capitalDeltaUsd: 120 }),
      }),
    );
    expect(t?.type).toBe("people_capital_divergence");
  });

  it("gives a repeated state the same fingerprint (dedupe)", () => {
    const a = emitStoryEvent(input({ yes: side({ believerDelta: 4, capitalDeltaUsd: -120 }) }));
    const b = emitStoryEvent(
      input({
        yes: side({ believerDelta: 6, capitalDeltaUsd: -150 }),
        prev: { type: "people_capital_divergence", side: "YES" },
      }),
    );
    expect(a?.type).toBe("people_capital_divergence");
    expect(a?.fingerprint).toBe(b?.fingerprint);
  });

  it("emits nothing on weak noise", () => {
    const t = emitStoryEvent(
      input({
        yes: side({ believerDelta: 1, capitalDeltaUsd: 5 }),
        no: side({ believerDelta: 1 }),
      }),
    );
    expect(t).toBeNull();
  });

  it("is deterministic — same input, same result", () => {
    const mk = () => input({ yes: side({ believerDelta: 0, capitalDeltaUsd: 300 }) });
    expect(emitStoryEvent(mk())).toEqual(emitStoryEvent(mk()));
  });
});

describe("money formatter is used when supplied", () => {
  it("formats capital in the caller's unit", () => {
    const t = emitStoryEvent(
      input({
        yes: side({ believerDelta: 4, capitalDeltaUsd: -120 }),
        money: (usd) => `€${usd.toFixed(0)}`,
      }),
    );
    expect(t?.detail).toContain("€120");
  });
});

// ── The vocabulary beyond price and flow. Everything below is computed from the
//    SAME snapshot the engine already received — believerBase is the count at the
//    window's open, so "what changed structurally" needs no new data. ──

describe("structural — the market's own answer changed", () => {
  it("names a majority flip above everything else", () => {
    const t = emitStoryEvent(
      input({
        // YES led 20–14 and lost it inside the window.
        yes: side({ believerBase: 20, believerDelta: 0 }),
        no: side({ believerBase: 14, believerDelta: 8 }),
      }),
    );
    expect(t?.type).toBe("majority_flipped");
    expect(t?.side).toBe("NO");
    expect(t?.headline).toBe("NO overtook YES.");
  });

  it("outranks a contradiction happening at the same time", () => {
    const t = emitStoryEvent(
      input({
        yes: side({ believerBase: 20, believerDelta: 4, capitalDeltaUsd: -120 }),
        no: side({ believerBase: 18, believerDelta: 8 }),
      }),
    );
    // People/capital divergence is true here too; the flip is bigger news.
    expect(t?.type).toBe("majority_flipped");
  });

  it("says nothing when the lead never actually changed hands", () => {
    const t = emitStoryEvent(
      input({
        yes: side({ believerBase: 20, believerDelta: 5 }),
        no: side({ believerBase: 10, believerDelta: 2 }),
      }),
    );
    expect(t?.type).not.toBe("majority_flipped");
  });

  it("refuses to call a majority in a market too small to have one", () => {
    const t = emitStoryEvent(
      input({
        yes: side({ believerBase: 2, believerDelta: 0, capitalBaseUsd: 10 }),
        no: side({ believerBase: 1, believerDelta: 2, capitalBaseUsd: 10 }),
      }),
    );
    expect(t?.type).not.toBe("majority_flipped");
  });

  it("names genuine, settled disagreement once it arrives", () => {
    const t = emitStoryEvent(
      input({
        // 30–20 becomes 30–26: lopsided (60%) to split (53%), no side doubling.
        yes: side({ believerBase: 30, believerDelta: 0, capitalDeltaUsd: 0 }),
        no: side({ believerBase: 20, believerDelta: 6, capitalDeltaUsd: 0 }),
      }),
    );
    expect(t?.type).toBe("market_balanced");
    expect(t?.headline).toBe("The market is evenly split.");
  });
});

describe("community — the crowd itself changed shape", () => {
  it("names a side doubling", () => {
    const t = emitStoryEvent(
      input({
        yes: side({ believerBase: 12, believerDelta: 14, capitalDeltaUsd: 0 }),
        no: side({ believerBase: 40, believerDelta: 0, capitalDeltaUsd: 0 }),
      }),
    );
    expect(t?.type).toBe("side_doubled");
    expect(t?.headline).toBe("Believers in YES doubled.");
    expect(t?.detail).toContain("12 to 26");
  });

  it("names a round number when a side crosses it", () => {
    const t = emitStoryEvent(
      input({ yes: side({ believerBase: 96, believerDelta: 7, capitalDeltaUsd: 0 }) }),
    );
    expect(t?.type).toBe("believer_milestone");
    expect(t?.headline).toBe("YES passed 100 believers.");
  });

  it("crossing 100 and later 500 are different stories, so neither silences the other", () => {
    const a = emitStoryEvent(
      input({ yes: side({ believerBase: 96, believerDelta: 7, capitalDeltaUsd: 0 }) }),
    );
    const b = emitStoryEvent(
      input({ yes: side({ believerBase: 480, believerDelta: 30, capitalDeltaUsd: 0 }) }),
    );
    expect(a?.fingerprint).not.toBe(b?.fingerprint);
  });

  it("never announces a milestone the side was already past", () => {
    const t = emitStoryEvent(
      input({ yes: side({ believerBase: 120, believerDelta: 5, capitalDeltaUsd: 0 }) }),
    );
    expect(t?.type).not.toBe("believer_milestone");
  });
});

describe("one engine, one voice", () => {
  const cases: StoryEventInput[] = [
    input({
      yes: side({ believerBase: 20, believerDelta: 0 }),
      no: side({ believerBase: 14, believerDelta: 8 }),
    }),
    input({ yes: side({ believerBase: 12, believerDelta: 14 }), no: side({ believerBase: 40 }) }),
    input({ yes: side({ believerBase: 96, believerDelta: 7 }) }),
    input({ yes: side({ believerDelta: 4, capitalDeltaUsd: -120 }) }),
    input({ yes: side({ believerDelta: -6 }) }),
    input({ social: { tribeJoinedYes: 4, tribeJoinedNo: 0 } }),
  ];

  it("says exactly one thing, or nothing — never two at once", () => {
    for (const c of cases) {
      const t = emitStoryEvent(c);
      if (!t) continue;
      expect(typeof t.headline).toBe("string");
      expect(t.headline.length).toBeGreaterThan(0);
      expect(t.fingerprint.length).toBeGreaterThan(0);
    }
  });

  it("every story carries evidence for its claim", () => {
    for (const c of cases) {
      const t = emitStoryEvent(c);
      if (!t) continue;
      expect(t.evidence.length).toBeGreaterThan(0);
      for (const e of t.evidence) expect(e.value.length).toBeGreaterThan(0);
    }
  });

  it("never uses hype or plumbing words", () => {
    const banned = /whale|smart money|moon|degen|pouring|exploding|wallet|transaction/i;
    for (const c of cases) {
      const t = emitStoryEvent(c);
      if (!t) continue;
      expect(`${t.headline} ${t.detail ?? ""}`).not.toMatch(banned);
    }
  });
});
