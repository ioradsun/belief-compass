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
  actor: { name: "John", relationship: null },
  side: "YES",
  action: "BUY",
  amountUsd: 25,
  market: null,
  ...o,
});

describe("composeLiveStory", () => {
  it("a buy reads as joining the army, with the stake", () => {
    expect(composeLiveStory(liveBase()).text).toBe("John joined the YES army for $25.00");
  });
  it("adds the strongest momentum hook — urgency wins", () => {
    const t = composeLiveStory(
      liveBase({ market: { newBackers1h: 12, believersYes: 40, moneyYesPct: 70 } }),
    ).text;
    expect(t).toBe("John joined the YES army for $25.00 — YES is heating up, 12 joined this hour");
  });
  it("falls back to bandwagon social proof when no urgency", () => {
    const t = composeLiveStory(liveBase({ market: { believersYes: 48 } })).text;
    expect(t).toBe("John joined the YES army for $25.00 — 48 now hold YES");
  });
  it("a network member keeps their relationship tag", () => {
    const t = composeLiveStory(liveBase({ actor: { name: "Maya", relationship: "twin" } })).text;
    expect(t).toBe("Maya (Twin) joined the YES army for $25.00");
  });
  it("a sell cuts the side; a flip defects", () => {
    expect(composeLiveStory(liveBase({ action: "SELL", side: "NO", amountUsd: 82 })).text).toBe(
      "John left the NO army for $82.00",
    );
    expect(composeLiveStory(liveBase({ flip: true, side: "YES", action: "BUY" })).text).toBe(
      "John defected to YES for $25.00",
    );
  });
  it("a burst has no name — the crowd piles in", () => {
    const t = composeLiveStory(
      liveBase({ actor: null, walletCount: 5, market: { believersYes: 30 } }),
    ).text;
    expect(t).toBe("5 believers piled into YES for $25.00 — 30 now hold YES");
  });
  it("never fabricates hype", () => {
    const banned = ["whale", "smart money", "moon", "degen", "pouring", "exploding", "guaranteed"];
    const t = composeLiveStory(
      liveBase({ market: { newBackers1h: 99, believersYes: 999, moneyYesPct: 99 } }),
    ).text.toLowerCase();
    for (const w of banned) expect(t).not.toContain(w);
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
