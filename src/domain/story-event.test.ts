import { describe, it, expect } from "vitest";
import {
  emitStoryEvent,
  CAPITAL_MILESTONES,
  type StoryEventInput,
  type SideWindow,
} from "./story-event";
import { changeFrom24hRow, materialMoves, MATERIAL } from "./market-change";
import { FEED_TRIGGERS } from "./feed-event";

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
    // Under the absolute floor even though it is a big fraction of a $30 book.
    // Taken FROM the constant so the fixture cannot quietly drift above it.
    const t = emitStoryEvent(
      input({
        yes: side({
          believerDelta: 4,
          capitalDeltaUsd: -FEED_TRIGGERS.capital.minUsd / 2,
          capitalBaseUsd: 30,
        }),
      }),
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

/**
 * THE FLOOR. Before this, a market whose YES capital rose twelve percent with no
 * other structure emitted NOTHING — every storyteller was looking for a SHAPE
 * (an answer flipping, people arriving while money leaves) and none was looking
 * for a size. The feeds could not report news nobody had written down.
 */
describe("a material move is never silently dropped", () => {
  /** The emitter's real path: market_state row → one change → ranked moves. */
  const movesFor = (over: Parameters<typeof changeFrom24hRow>[0]) =>
    materialMoves(changeFrom24hRow(over));

  it("reports a plain capital rise that has no other shape", () => {
    // Capital and believers move together, so no divergence storyteller fires.
    const t = emitStoryEvent(
      input({
        yes: side({ believerDelta: 1, capitalDeltaUsd: 60, capitalBaseUsd: 500 }),
        material: movesFor({
          believersYes: 21,
          newBelieversYes24h: 1,
          yesCapitalUsd: 560,
          yesCapitalDelta24h: 60,
          believersNo: 20,
          newBelieversNo24h: 0,
          noCapitalUsd: 500,
          noCapitalDelta24h: 0,
        }),
      }),
    );
    expect(t?.type).toBe("material_move");
    expect(t?.side).toBe("YES");
    expect(t?.headline).toBe("Capital on YES rose +12%");
    expect(t?.tier).toBe(1);
  });

  it("keeps the metric in the fingerprint so one move cannot hide another", () => {
    const t = emitStoryEvent(
      input({
        yes: side({ believerDelta: 1, capitalDeltaUsd: 60, capitalBaseUsd: 500 }),
        material: movesFor({
          believersYes: 21,
          newBelieversYes24h: 1,
          yesCapitalUsd: 560,
          yesCapitalDelta24h: 60,
          believersNo: 20,
          newBelieversNo24h: 0,
          noCapitalUsd: 500,
          noCapitalDelta24h: 0,
        }),
      }),
    );
    expect(t?.fingerprint).toBe("material_move:capital:YES");
  });

  it("says nothing when nothing cleared the bar", () => {
    expect(
      emitStoryEvent(
        input({
          material: movesFor({
            believersYes: 20,
            newBelieversYes24h: 0,
            yesCapitalUsd: 500,
            yesCapitalDelta24h: 2,
            believersNo: 20,
            newBelieversNo24h: 0,
            noCapitalUsd: 500,
            noCapitalDelta24h: 0,
          }),
        }),
      ),
    ).toBeNull();
  });

  /**
   * A shaped story is also a large move, so the floor must not take its place —
   * "more believers, less capital" tells the reader something a percentage
   * cannot.
   */
  it("yields to a story that has a shape", () => {
    const t = emitStoryEvent(
      input({
        yes: side({ believerDelta: 4, capitalDeltaUsd: -120 }),
        material: movesFor({
          believersYes: 24,
          newBelieversYes24h: 4,
          yesCapitalUsd: 380,
          yesCapitalDelta24h: -120,
          believersNo: 20,
          newBelieversNo24h: 0,
          noCapitalUsd: 500,
          noCapitalDelta24h: 0,
        }),
      }),
    );
    expect(t?.type).toBe("people_capital_divergence");
  });

  it("never manufactures news from a dust base", () => {
    // $0.004 → $2.70 is the market that started all of this.
    const moves = movesFor({
      yesCapitalUsd: 2.6959,
      yesCapitalDelta24h: 2.6919,
      believersYes: 3,
      newBelieversYes24h: 2,
      believersNo: 0,
      newBelieversNo24h: 0,
      noCapitalUsd: 0,
      noCapitalDelta24h: 0,
    });
    expect(moves.every((m) => m.pct == null)).toBe(true);
    const t = emitStoryEvent(input({ material: moves }));
    // Whatever is said about it, it is never said as a rate.
    expect(t?.detail ?? "").not.toMatch(/%/);
  });

  it("holds the product's five percent line", () => {
    expect(MATERIAL.minPct).toBe(5);
  });
});

/**
 * CELEBRATIONS FROM DATA WE ALREADY KEEP.
 *
 * Nothing here needs a new table, a new emitter or a backfill: a capital
 * milestone is the two sides added, and a reawakening is the week's trade count
 * equalling the day's.
 */
describe("the community crossing a number is the good news it is", () => {
  const funded = (over: Partial<SideWindow> = {}) =>
    side({ capitalBaseUsd: 40, capitalDeltaUsd: 0, ...over });
  /** The formatter the emitter actually passes, so the copy is the real copy. */
  const money = (usd: number) => `$${Math.round(usd)}`;

  it("announces the market passing a rung", () => {
    // $80 → $110 crosses $100. Believers rise with the money so this is not
    // also "capital concentrating", which is a contradiction and outranks it.
    const t = emitStoryEvent(
      input({
        yes: funded({ capitalDeltaUsd: 30, believerDelta: 2 }),
        no: funded({ capitalBaseUsd: 40 }),
        money,
      }),
    );
    expect(t?.type).toBe("capital_milestone");
    expect(t?.headline).toBe("This question has drawn $100");
    expect(t?.fingerprint).toBe("capital_milestone:100");
  });

  it("takes the highest rung crossed, not the first", () => {
    const t = emitStoryEvent(
      input({
        yes: side({ capitalBaseUsd: 4, capitalDeltaUsd: 100, believerDelta: 2 }),
        no: side({ capitalBaseUsd: 4, capitalDeltaUsd: 0 }),
      }),
    );
    expect(t?.fingerprint).toBe("capital_milestone:100");
  });

  it("says nothing when no rung was crossed", () => {
    const t = emitStoryEvent(
      input({ yes: funded({ capitalDeltaUsd: 1 }), no: funded({ capitalBaseUsd: 30 }) }),
    );
    expect(t?.type).not.toBe("capital_milestone");
  });

  /**
   * The emitter passes zero for a side whose history is missing. A crossing
   * measured against a fabricated zero would announce a milestone on a market
   * that has been sitting above it for weeks.
   */
  it("never claims a crossing it measured against a missing baseline", () => {
    const t = emitStoryEvent(
      input({
        yes: side({ capitalBaseUsd: 0, capitalDeltaUsd: 0 }),
        no: side({ capitalBaseUsd: 0, capitalDeltaUsd: 0 }),
      }),
    );
    expect(t?.type).not.toBe("capital_milestone");
  });

  /**
   * Kept as headroom the platform should grow into: the largest live market
   * holds $197, so a ladder that started at $1,000 could never have fired.
   */
  it("starts the ladder where the community actually is", () => {
    expect(CAPITAL_MILESTONES[0]).toBeLessThanOrEqual(10);
    expect(CAPITAL_MILESTONES).toContain(1_000);
    expect(CAPITAL_MILESTONES).toContain(100_000);
  });
});

describe("a market that went quiet and came back", () => {
  const funded = () => side({ capitalBaseUsd: 40, capitalDeltaUsd: 0, believerDelta: 0 });

  it("reads a silent week from the cumulative counts", () => {
    const t = emitStoryEvent(
      input({ yes: funded(), no: funded(), activity: { trades24h: 3, trades7d: 3 } }),
    );
    expect(t?.type).toBe("market_reawakened");
    expect(t?.detail).toBe("First trades in a week — 3 trades today.");
  });

  it("says nothing while the week was busy throughout", () => {
    const t = emitStoryEvent(
      input({ yes: funded(), no: funded(), activity: { trades24h: 3, trades7d: 11 } }),
    );
    expect(t?.type).not.toBe("market_reawakened");
  });

  /** A market that opened yesterday also has all its week's trades today. */
  it("does not call a birth a return", () => {
    const t = emitStoryEvent(
      input({
        yes: side({ capitalBaseUsd: 0, capitalDeltaUsd: 20 }),
        no: side({ capitalBaseUsd: 0, capitalDeltaUsd: 0 }),
        activity: { trades24h: 3, trades7d: 3 },
      }),
    );
    expect(t?.type).not.toBe("market_reawakened");
  });

  it("makes no such claim without the counts", () => {
    expect(emitStoryEvent(input({ yes: funded(), no: funded() }))?.type).not.toBe(
      "market_reawakened",
    );
  });
});

/**
 * WHAT THE FEED MUST NOT SAY TWICE.
 *
 * These rules exist because a real logged-out feed showed the same fact wearing
 * two badges: "Alex left YES with $15" immediately beside "Capital on YES fell
 * −83%" on the same market in the same hour, and "duckfacts is the first to back
 * NO" beside an anonymous "NO has its first believers". One event, told twice,
 * reads as two events — which is worse than saying it once.
 */
describe("one fact is told once", () => {
  const movesFor = (over: Parameters<typeof changeFrom24hRow>[0]) =>
    materialMoves(changeFrom24hRow(over));

  it("stays silent on a side's first believers — the conviction feed names them", () => {
    const t = emitStoryEvent(
      input({
        yes: side({ believerDelta: 1, believerBase: 0, capitalDeltaUsd: 0, capitalBaseUsd: 0 }),
        no: side({ believerBase: 0, capitalBaseUsd: 0 }),
        material: movesFor({
          believersYes: 1,
          newBelieversYes24h: 1,
          yesCapitalUsd: 0,
          yesCapitalDelta24h: 0,
          believersNo: 0,
          newBelieversNo24h: 0,
          noCapitalUsd: 0,
          noCapitalDelta24h: 0,
        }),
      }),
    );
    expect(t?.headline ?? "").not.toMatch(/has its first believers/);
  });

  it("stays silent on capital leaving when the believers leaving is the story", () => {
    // −$400 of $500 is a −80% drain, and a believer went with it.
    const t = emitStoryEvent(
      input({
        yes: side({
          believerDelta: -1,
          believerBase: 4,
          capitalDeltaUsd: -400,
          capitalBaseUsd: 500,
        }),
        material: movesFor({
          believersYes: 3,
          newBelieversYes24h: -1,
          yesCapitalUsd: 100,
          yesCapitalDelta24h: -400,
          believersNo: 20,
          newBelieversNo24h: 0,
          noCapitalUsd: 500,
          noCapitalDelta24h: 0,
        }),
      }),
    );
    expect(t?.headline ?? "").not.toMatch(/Capital on YES fell/);
  });

  it("still reports capital leaving when NOBODY left — that is a holder trimming", () => {
    const t = emitStoryEvent(
      input({
        yes: side({
          believerDelta: 0,
          believerBase: 4,
          capitalDeltaUsd: -400,
          capitalBaseUsd: 500,
        }),
        material: movesFor({
          believersYes: 4,
          newBelieversYes24h: 0,
          yesCapitalUsd: 100,
          yesCapitalDelta24h: -400,
          believersNo: 20,
          newBelieversNo24h: 0,
          noCapitalUsd: 500,
          noCapitalDelta24h: 0,
        }),
      }),
    );
    expect(t).not.toBeNull();
  });

  it("never explains its own threshold to the reader", () => {
    const t = emitStoryEvent(
      input({
        yes: side({ believerDelta: 1, capitalDeltaUsd: 60, capitalBaseUsd: 500 }),
        material: movesFor({
          believersYes: 21,
          newBelieversYes24h: 1,
          yesCapitalUsd: 560,
          yesCapitalDelta24h: 60,
          believersNo: 20,
          newBelieversNo24h: 0,
          noCapitalUsd: 500,
          noCapitalDelta24h: 0,
        }),
      }),
    );
    expect(t?.detail).toBe("+12% over 1D");
    expect(t?.detail ?? "").not.toMatch(/treats as news/);
  });
});

describe("a return needs more than one trade", () => {
  const woken = (trades: number) =>
    emitStoryEvent(
      input({
        yes: side({ capitalBaseUsd: 500 }),
        no: side({ capitalBaseUsd: 500 }),
        activity: { trades24h: trades, trades7d: trades },
      }),
    );

  it("says nothing on a single fill — one trade is not a market waking up", () => {
    expect(woken(1)?.type).not.toBe("market_reawakened");
  });

  it("calls it awake once a second person agrees", () => {
    expect(woken(2)?.type).toBe("market_reawakened");
  });
});
