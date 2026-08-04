import { describe, it, expect } from "vitest";
import {
  composeMarketStory,
  composeLiveStory,
  type StoryInput,
  type NetworkFace,
  type LiveStoryInput,
} from "./story";

const face = (o: Partial<NetworkFace>): NetworkFace => ({
  wallet: "0xa",
  name: "Maya",
  avatarUrl: null,
  relationship: "twin",
  side: "YES",
  ...o,
});

const base = (o: Partial<StoryInput> = {}): StoryInput => ({
  recent: null,
  momentum: {},
  classification: null,
  network: [],
  ...o,
});

const BANNED = ["whale", "smart money", "pouring", "exploding", "moon", "degen", "loading up"];

describe("story ordering", () => {
  it("emits beats in event → momentum → relationship order", () => {
    const s = composeMarketStory(
      base({
        recent: { text: "3 wallets backed NO" },
        momentum: { moneyYesPct: 68, newBackers1h: 31 },
        classification: "hot",
        network: [face({ relationship: "twin", side: "YES" })],
      }),
    );
    expect(s.beats.map((b) => b.kind)).toEqual(["event", "momentum", "relationship"]);
  });

  it("omits beats with nothing true to say (cold market)", () => {
    const s = composeMarketStory(base());
    expect(s.beats).toHaveLength(0);
    expect(s.crowd).toBeNull();
  });
});

describe("momentum beat", () => {
  it("hot with recent backers reads as movement, not hype", () => {
    const s = composeMarketStory(
      base({ classification: "hot", momentum: { moneyYesPct: 70, newBackers1h: 31 } }),
    );
    const m = s.beats.find((b) => b.kind === "momentum")!;
    expect(m.text).toContain("31 backed it in the last hour");
    expect(m.emoji).toBe("🔥");
    expect(m.tone).toBe("hot");
  });
  it("early paints quiet growth", () => {
    const s = composeMarketStory(
      base({ classification: "early", momentum: { newBackers24h: 12, moneyYesPct: 40 } }),
    );
    expect(s.beats.find((b) => b.kind === "momentum")!.text).toContain("12 new believers today");
  });
  it("surfaces people-vs-money divergence with no classification", () => {
    const s = composeMarketStory(base({ momentum: { peopleYesPct: 78, moneyYesPct: 45 } }));
    const m = s.beats.find((b) => b.kind === "momentum")!;
    expect(m.text).toContain("People lean YES");
    expect(m.text).toContain("money leans NO");
  });
});

describe("relationship beat", () => {
  it("names a Twin with their side", () => {
    const s = composeMarketStory(
      base({
        momentum: { moneyYesPct: 60 },
        network: [face({ name: "Maya", relationship: "twin", side: "YES" })],
      }),
    );
    expect(s.beats.find((b) => b.kind === "relationship")!.text).toBe("Maya (your Twin) is on YES");
  });
  it("names a Rival (the mid-tier opposite)", () => {
    const s = composeMarketStory(
      base({
        momentum: { moneyYesPct: 40 },
        network: [face({ name: "Ravi", relationship: "opp", side: "NO" })],
      }),
    );
    expect(s.beats.find((b) => b.kind === "relationship")!.text).toBe("Your Rival Ravi is on NO");
  });
  it("an ally + adversary on opposite sides becomes the split beat", () => {
    const s = composeMarketStory(
      base({
        momentum: { moneyYesPct: 55 },
        network: [
          face({ name: "Maya", relationship: "tribe", side: "YES" }),
          face({ wallet: "0xb", name: "Ravi", relationship: "opp", side: "NO" }),
        ],
      }),
    );
    expect(s.beats.find((b) => b.kind === "relationship")!.text).toBe(
      "Your Tribe and your Rival are split here",
    );
  });
});

describe("privacy rule", () => {
  it("crowd is a count on the money's side, never a name", () => {
    const s = composeMarketStory(base({ momentum: { moneyYesPct: 62, newBackers24h: 42 } }));
    expect(s.crowd).toEqual({ side: "YES", count: 42 });
    expect(s.faces).toHaveLength(0); // no network → no named faces
  });
  it("only network members appear in faces", () => {
    const s = composeMarketStory(base({ network: [face({ name: "Maya" })] }));
    expect(s.faces.map((f) => f.name)).toEqual(["Maya"]);
  });
  it("never prints a name that was not provided as a network face", () => {
    const s = composeMarketStory(
      base({
        recent: { text: "someone backed YES" },
        momentum: { moneyYesPct: 60, newBackers24h: 40 },
      }),
    );
    for (const b of s.beats) expect(b.text).not.toMatch(/0x[a-f0-9]/i);
    expect(s.beats.some((b) => b.text === "Maya (your Twin) is on YES")).toBe(false);
  });
});

// ── Live-event story ──────────────────────────────────────────────────────────
const liveBase = (o: Partial<LiveStoryInput> = {}): LiveStoryInput => ({
  kind: "trade_burst",
  actor: { name: "John", relationship: null },
  side: "YES",
  action: "BUY",
  amountUsd: 25,
  market: null,
  ...o,
});

describe("composeLiveStory — people are the story", () => {
  it("names the person first on a buy; scale is the supporting line", () => {
    const s = composeLiveStory(liveBase({ market: { believersYes: 9 } }));
    expect(s.category).toBe("growing");
    expect(s.headline).toBe("YES IS GROWING");
    expect(s.body).toBe("John joined YES.");
    expect(s.attribution).toBe("9 believers now.");
  });

  it("names the person first on a sell", () => {
    const s = composeLiveStory(
      liveBase({ action: "SELL", side: "NO", market: { believersNo: 8 } }),
    );
    expect(s.headline).toBe("NO IS SHRINKING");
    expect(s.body).toBe("John left NO.");
    expect(s.attribution).toBe("8 believers now.");
  });

  it("counts people when no one can be named", () => {
    const s = composeLiveStory(liveBase({ actor: null, walletCount: 4 }));
    expect(s.body).toBe("4 people joined YES.");
  });

  it("money is what a person acted WITH, never the subject", () => {
    const s = composeLiveStory(liveBase({ kind: "large_trade", amountUsd: 420, side: "NO" }));
    expect(s.category).toBe("capital_in");
    expect(s.body).toBe("John backed NO with $420.");
    // The amount may never open the sentence.
    expect(s.body.startsWith("$")).toBe(false);
  });

  it("an exit is a person leaving, not capital moving", () => {
    const s = composeLiveStory(
      liveBase({ kind: "large_trade", action: "SELL", amountUsd: 860, side: "YES" }),
    );
    expect(s.body).toBe("John pulled $860 out of YES.");
    expect(s.body.startsWith("$")).toBe(false);
  });

  it("a switch names who changed their mind", () => {
    const s = composeLiveStory(liveBase({ kind: "side_shift", side: "NO" }));
    expect(s.headline).toBe("SWITCHED SIDES");
    expect(s.body).toBe("John switched to NO.");
  });

  it("a new market makes the question the hero and drops the redundant 'just opened'", () => {
    const s = composeLiveStory({
      kind: "market_created",
      side: null,
      question: "Is working actually slavery?",
      actor: { name: "@dana", relationship: null },
    });
    expect(s.category).toBe("fresh_market");
    expect(s.body).toBe("Is working actually slavery?");
    expect(s.attribution).toBe("@dana opened it.");
  });

  it("says nothing rather than repeating the timestamp", () => {
    const s = composeLiveStory({ kind: "market_created", side: null, question: "Will it rain?" });
    expect(s.attribution).toBeNull();
  });

  it("a milestone states the number plainly", () => {
    const s = composeLiveStory({ kind: "believer_milestone", side: "YES", threshold: 50 });
    expect(s.headline).toBe("MILESTONE");
    expect(s.body).toBe("YES reached 50 believers.");
  });
});

describe("composeLiveStory — no line repeats another", () => {
  const inputs: LiveStoryInput[] = [
    liveBase({ market: { believersYes: 9 } }),
    liveBase({ action: "SELL", side: "NO", market: { believersNo: 8 } }),
    liveBase({ kind: "large_trade", amountUsd: 420, side: "NO" }),
    liveBase({ kind: "large_trade", action: "SELL", amountUsd: 860, side: "YES" }),
    liveBase({ kind: "side_shift", side: "YES" }),
    liveBase({ kind: "round_trip", side: "YES" }),
    liveBase({ actor: { name: "Maya", relationship: "twin" } }),
    { kind: "believer_milestone", side: "YES", threshold: 50 },
    { kind: "tribe_doubled", side: "YES" },
    {
      kind: "market_created",
      side: null,
      question: "Will it rain?",
      actor: { name: "D", relationship: null },
    },
  ];

  it("the headline is a kicker, never a sentence", () => {
    for (const i of inputs) {
      const h = composeLiveStory(i).headline;
      expect(h).not.toMatch(/\.$/);
      expect(h.split(/\s+/).length).toBeLessThanOrEqual(3);
    }
  });

  it("the attribution never restates the body", () => {
    for (const i of inputs) {
      const s = composeLiveStory(i);
      if (!s.attribution) continue;
      const core = (t: string) =>
        t
          .toLowerCase()
          .replace(/[^a-z0-9 ]/g, "")
          .trim();
      expect(core(s.attribution)).not.toBe(core(s.body));
      // "John joined." next to "John joined YES." was the old shape.
      expect(s.body.includes(s.attribution.replace(/\.$/, ""))).toBe(false);
    }
  });
});

describe("composeLiveStory — network is side-blind", () => {
  it("a Twin move never reveals their side", () => {
    const s = composeLiveStory(liveBase({ actor: { name: "Maya", relationship: "twin" } }));
    expect(s.category).toBe("twin");
    expect(s.headline).toBe("YOUR TWIN");
    expect(s.personal).toBe(true);
    expect(s.tone).toBe("neutral");
    expect(`${s.headline} ${s.body}`).not.toMatch(/\bYES\b|\bNO\b/);
  });

  it("a Tribe / Rival move surfaces belonging, not a side", () => {
    expect(
      composeLiveStory(liveBase({ actor: { name: "A", relationship: "tribe" } })).headline,
    ).toBe("YOUR TRIBE");
    expect(composeLiveStory(liveBase({ actor: { name: "B", relationship: "opp" } })).headline).toBe(
      "YOUR RIVAL",
    );
  });
});

describe("composeLiveStory — copy discipline", () => {
  it("never says a side has a 'tribe' and never uses banned terms", () => {
    const banned =
      /tribe|wallet|address|transaction|position|holder|whale|smart money|moon|pouring/i;
    const inputs: LiveStoryInput[] = [
      liveBase({ market: { believersYes: 9 } }),
      liveBase({ action: "SELL", side: "NO", market: { believersNo: 8 } }),
      liveBase({ kind: "large_trade", amountUsd: 420, side: "NO" }),
      liveBase({ kind: "side_shift", side: "YES" }),
      { kind: "believer_milestone", side: "YES", threshold: 50 },
      { kind: "tribe_doubled", side: "YES" },
    ];
    for (const i of inputs) {
      const s = composeLiveStory(i);
      expect(`${s.headline} ${s.body} ${s.attribution ?? ""}`).not.toMatch(banned);
    }
  });
});

describe("voice", () => {
  it("never uses hype words across a spread of inputs", () => {
    const inputs: StoryInput[] = [
      base({ classification: "hot", momentum: { moneyYesPct: 90, newBackers1h: 99 } }),
      base({ classification: "early", momentum: { newBackers24h: 3 } }),
      base({ classification: "hidden", momentum: { uniqueWallets24h: 20 } }),
      base({ classification: "contested", momentum: { moneyYesPct: 50 } }),
      base({ classification: "conviction", momentum: { moneyYesPct: 80 } }),
      base({ classification: "new", momentum: { newBackers24h: 5 } }),
      base({ momentum: { peopleYesPct: 20, moneyYesPct: 80 } }),
    ];
    for (const i of inputs) {
      for (const b of composeMarketStory(i).beats) {
        const t = b.text.toLowerCase();
        for (const w of BANNED) expect(t).not.toContain(w);
      }
    }
  });
});
