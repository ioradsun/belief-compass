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
    expect(m.text).toContain("31 backed in the last hour");
    expect(m.emoji).toBe("🔥");
    expect(m.tone).toBe("hot");
  });
  it("early paints quiet growth", () => {
    const s = composeMarketStory(
      base({ classification: "early", momentum: { newBackers24h: 12, moneyYesPct: 40 } }),
    );
    expect(s.beats.find((b) => b.kind === "momentum")!.text).toContain("12 new backers today");
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
  it("names an Opp", () => {
    const s = composeMarketStory(
      base({
        momentum: { moneyYesPct: 40 },
        network: [face({ name: "Ravi", relationship: "opp", side: "NO" })],
      }),
    );
    expect(s.beats.find((b) => b.kind === "relationship")!.text).toBe("Your Opp Ravi is on NO");
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
      "Your Tribe and your Opp are split here",
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

describe("composeLiveStory — market as protagonist", () => {
  it("a buy leads with the market growing, names the actor last", () => {
    const s = composeLiveStory(liveBase({ market: { believersYes: 9 } }));
    expect(s.category).toBe("growing");
    expect(s.headline).toBe("YES IS GROWING");
    expect(s.body).toBe("9 believers now back YES.");
    expect(s.attribution).toBe("John joined.");
  });

  it("a sell reads as the side losing a believer", () => {
    const s = composeLiveStory(liveBase({ action: "SELL", side: "NO", market: { believersNo: 8 } }));
    expect(s.headline).toBe("NO LOST A BELIEVER");
    expect(s.body).toBe("8 still back NO.");
    expect(s.attribution).toBe("John exited.");
  });

  it("large capital is a money story", () => {
    const s = composeLiveStory(liveBase({ kind: "large_trade", amountUsd: 420, side: "NO" }));
    expect(s.category).toBe("capital_in");
    expect(s.body).toBe("$420 moved into NO.");
  });

  it("a fresh market makes the question the hero", () => {
    const s = composeLiveStory({
      kind: "market_created",
      side: null,
      question: "Is working actually slavery?",
      actor: { name: "@dana", relationship: null },
    });
    expect(s.category).toBe("fresh_market");
    expect(s.body).toBe("Is working actually slavery?");
    expect(s.attribution).toBe("@dana opened this market.");
  });

  it("a milestone celebrates the market", () => {
    const s = composeLiveStory({ kind: "believer_milestone", side: "YES", threshold: 50 });
    expect(s.headline).toBe("MILESTONE");
    expect(s.body).toBe("YES just reached 50 believers.");
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

  it("a Tribe / Opp move surfaces belonging, not a side", () => {
    expect(composeLiveStory(liveBase({ actor: { name: "A", relationship: "tribe" } })).headline).toBe(
      "YOUR TRIBE",
    );
    expect(composeLiveStory(liveBase({ actor: { name: "B", relationship: "opp" } })).headline).toBe(
      "YOUR OPP",
    );
  });
});

describe("composeLiveStory — copy discipline", () => {
  it("never says a side has a 'tribe' and never uses banned terms", () => {
    const banned = /tribe|wallet|address|transaction|position|holder|whale|smart money|moon|pouring/i;
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
