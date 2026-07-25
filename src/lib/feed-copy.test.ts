import { describe, it, expect } from "vitest";
import {
  composeCard,
  cleanName,
  isMaterialDivergence,
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
