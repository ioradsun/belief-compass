import { describe, it, expect } from "vitest";
import {
  composeCard,
  cleanName,
  isMaterialDivergence,
  convictionShape,
  MATERIAL_DIVERGENCE_PTS,
  type CopyInput,
} from "./feed-copy";

const base: Omit<CopyInput, "behavior"> = {
  actorName: "Ramo",
  actorScale: "individual",
  actorRole: "creator",
  belief: "Will AI create more jobs than it destroys?",
  side: "YES",
  capitalCommitted: null,
  capitalWithdrawn: null,
  backersTotal: 6,
  believersYes: 5,
  believersNo: 1,
  priceFell: false,
  priceChgPct: null,
  moneyYesPct: null,
  peopleYesPct: null,
  yesCapitalUsd: null,
  noCapitalUsd: null,
  convergence: false,
  variantSeed: 0,
  isViewerHolding: false,
};

// Every generated line must pass the say-it-out-loud-and-true test.
const BANNED =
  /and climbing|know about it|winning|get in before|don't miss|only \d+ (?:people )?know/i;
function assertClean(...lines: (string | null)[]) {
  for (const l of lines) if (l) expect(BANNED.test(l)).toBe(false);
}

describe("cleanName — no leaked internals", () => {
  it("strips '(on farcaster)' style suffixes", () => {
    expect(cleanName("duckfacts.eth (on farcaster)")).toBe("duckfacts.eth");
  });
  it("never surfaces a bare 0x address as a name", () => {
    expect(cleanName("0x75B5Fc4a2C0b9cE467880126BB261FFdC1876188")).toBeNull();
  });
  it("passes a real name through", () => {
    expect(cleanName("ROIresearch")).toBe("ROIresearch");
    expect(cleanName(null)).toBeNull();
  });
});

describe("born (a belief is planted)", () => {
  it("reads like the canonical after-example", () => {
    const c = composeCard({ ...base, behavior: "born" });
    expect(c.hook).toBe("Ramo planted a new belief.");
    expect(c.belief).toBe(base.belief);
    expect(c.story).toBe("6 people have backed it so far — 5 yes, 1 no.");
    expect(c.turn).toBeNull(); // 5–1 is agreement, no manufactured tension
    expect(c.action.kind).toBe("open"); // not a forced trade
    assertClean(c.hook, c.story, c.turn);
  });
  it("degrades to 'a new belief' with no known creator", () => {
    const c = composeCard({ ...base, behavior: "born", actorName: null });
    expect(c.hook).toBe("A new belief just appeared.");
  });
});

describe("joined — don't lead with tiny wealth", () => {
  it("omits a sub-$1k figure from the hook", () => {
    const c = composeCard({
      ...base,
      behavior: "joined",
      actorName: "Quiet River",
      capitalCommitted: 816,
    });
    expect(c.hook).toBe("Quiet River just backed YES.");
    expect(c.hook).not.toContain("$");
  });
  it("surfaces a material figure", () => {
    const c = composeCard({
      ...base,
      behavior: "joined",
      actorName: "Quiet River",
      capitalCommitted: 12000,
    });
    expect(c.hook).toBe("Quiet River just put $12k behind YES.");
  });
});

describe("wealth states are never conflated", () => {
  it("reduce uses flow language — never 'realized' a loss", () => {
    const c = composeCard({
      ...base,
      behavior: "reduce",
      actorName: "Orange Fox",
      actorRole: "opp",
      capitalWithdrawn: 820000,
    });
    expect(c.story).toContain("Pulled $820k out");
    expect(c.hook + c.story).not.toMatch(/realized|profit|gain/i);
    expect(c.action.kind).toBe("convictions"); // about who they are
  });
  it("group flow says 'moved into' / 'left', never 'realized'", () => {
    const c = composeCard({
      ...base,
      behavior: "flow",
      actorName: null,
      actorScale: "market",
      actorRole: "market",
      capitalCommitted: 184000,
    });
    expect(c.hook).toBe("$184k moved into YES.");
    expect(c.hook).not.toMatch(/realized|gain/i);
  });
});

describe("conviction shape — People vs Capital (broad vs concentrated)", () => {
  it("many believers on one side but near-even capital → the signature story", () => {
    const s = convictionShape({
      believersYes: 412,
      believersNo: 89,
      yesCapitalUsd: 1_200_000,
      noCapitalUsd: 1_100_000,
    });
    expect(s).toBe(
      "YES has 4.6× more believers but nearly equal capital — conviction is broad on YES, concentrated on NO.",
    );
  });
  it("no story when both believers and capital agree", () => {
    expect(
      convictionShape({
        believersYes: 400,
        believersNo: 80,
        yesCapitalUsd: 1_000_000,
        noCapitalUsd: 100_000,
      }),
    ).toBeNull();
  });
  it("no story with too few believers or missing capital", () => {
    expect(
      convictionShape({ believersYes: 2, believersNo: 0, yesCapitalUsd: 100, noCapitalUsd: 100 }),
    ).toBeNull();
    expect(
      convictionShape({
        believersYes: 40,
        believersNo: 5,
        yesCapitalUsd: null,
        noCapitalUsd: null,
      }),
    ).toBeNull();
  });
  it("promotes the card to a tension format when the shape is a story", () => {
    const c = composeCard({
      ...base,
      behavior: "flow",
      believersYes: 412,
      believersNo: 89,
      yesCapitalUsd: 1_200_000,
      noCapitalUsd: 1_100_000,
    });
    expect(c.shape).not.toBeNull();
    expect(c.format).toBe("tension");
  });
});

describe("attribution verbs are earned (wired into the story)", () => {
  it("climbs to 'drove the move' only with strong, timely evidence", () => {
    const c = composeCard({
      ...base,
      behavior: "joined",
      actorName: "Quiet River",
      actorRole: "people",
      attribution: { shareOfMove: 0.3, actedBefore: true, actedDuring: false },
    });
    expect(c.story).toBe("They drove the move.");
    assertClean(c.hook, c.story, c.turn);
  });
  it("does not claim any 'move' verb on thin evidence — falls back to plain story", () => {
    const c = composeCard({
      ...base,
      behavior: "joined",
      actorName: "Quiet River",
      attribution: { shareOfMove: 0.05, actedBefore: true, actedDuring: false },
    });
    expect(c.story).not.toMatch(/move/i);
    expect(c.story).toBe("6 people are behind this now.");
  });
});

describe("momentum — accelerate is a measured rate, gated upstream", () => {
  it("states the measured acceleration and never says 'and climbing'", () => {
    const c = composeCard({ ...base, behavior: "accelerate", side: "YES", accelRatio: 1.5 });
    expect(c.format).toBe("momentum");
    expect(c.hook).toBe("Backing on YES is speeding up — 50% more this window than last.");
    assertClean(c.hook, c.story, c.turn);
  });
  it("momentum is not overridden into a scoreboard by a big move", () => {
    const c = composeCard({
      ...base,
      behavior: "accelerate",
      side: "NO",
      accelRatio: 2,
      priceChgPct: 40,
    });
    expect(c.format).toBe("momentum");
  });
});

describe("achievement — structural milestone only", () => {
  it("renders the provided structural text and stays present-tense", () => {
    const c = composeCard({
      ...base,
      behavior: "milestone",
      achievementText: "#2 most-backed belief right now — 120 believers.",
      believersYes: 90,
      believersNo: 30,
    });
    expect(c.format).toBe("achievement");
    expect(c.hook).toBe("#2 most-backed belief right now — 120 believers.");
    expect(c.story).toBe("90 backing YES, 30 NO.");
    expect(c.hook + c.story).not.toMatch(/early|beat|profit|gain/i);
    expect(c.timeLabel).toBe("Ranked");
  });
});

describe("timestamps name their event", () => {
  it("labels the event behind the time", () => {
    expect(composeCard({ ...base, behavior: "born" }).timeLabel).toBe("Created");
    expect(composeCard({ ...base, behavior: "joined" }).timeLabel).toBe("Backed");
    expect(composeCard({ ...base, behavior: "reduce" }).timeLabel).toBe("Reduced");
    expect(composeCard({ ...base, behavior: "flow" }).timeLabel).toBe("Last traded");
  });
});

describe("copy variety — neighbors don't repeat the opening phrase", () => {
  it("births read differently across seeds, but stably per seed", () => {
    const hooks = [0, 1, 2].map(
      (variantSeed) => composeCard({ ...base, behavior: "born", variantSeed }).hook,
    );
    expect(new Set(hooks).size).toBe(3); // three distinct openings
    expect(composeCard({ ...base, behavior: "born", variantSeed: 0 }).hook).toBe(hooks[0]); // stable
    for (const h of hooks) assertClean(h);
  });
  it("wraps around so any seed is valid", () => {
    expect(composeCard({ ...base, behavior: "born", variantSeed: 3 }).hook).toBe(
      composeCard({ ...base, behavior: "born", variantSeed: 0 }).hook,
    );
  });
});

describe("divergence-only turn (threshold is real)", () => {
  it("no turn when money and people agree", () => {
    const c = composeCard({ ...base, behavior: "joined", moneyYesPct: 84, peopleYesPct: 79 });
    expect(c.turn).toBeNull(); // 5-pt gap is not a story
  });
  it("no turn just below threshold", () => {
    expect(isMaterialDivergence(60, 60 - (MATERIAL_DIVERGENCE_PTS - 1))).toBe(false);
  });
  it("turn appears at material divergence, phrased as tension", () => {
    const c = composeCard({ ...base, behavior: "joined", moneyYesPct: 84, peopleYesPct: 52 });
    expect(c.turn).toBe("The money's 84% YES. The people are split 52–48.");
    expect(c.action.kind).toBe("back_sides"); // live tension → let them take a side
    assertClean(c.hook, c.story, c.turn);
  });
});
