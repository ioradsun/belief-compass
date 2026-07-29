import { describe, it, expect } from "vitest";
import {
  slugify,
  makeQuestionId,
  checkYesNo,
  seedWeiFromUsd,
  minSeedUsd,
  checkSeed,
  checkBalance,
  createMarketArgs,
  questionSimilarity,
  isNearDuplicate,
  V1_YES_AGENT,
  V1_NO_AGENT,
} from "./create-market";

describe("questionId — immutable, legible, unique", () => {
  it("slugifies to a bounded, id-safe string", () => {
    expect(slugify("Is “Everest” a HIT?!")).toBe("is-everest-a-hit");
    expect(slugify("  multiple   spaces & symbols!! ")).toBe("multiple-spaces-symbols");
    expect(slugify("")).toBe("");
  });
  it("combines a slug with a caller-supplied unique id", () => {
    const id = makeQuestionId("Will ETH flip BTC?", "01K1ABC");
    expect(id).toBe("conviction-will-eth-flip-btc-01K1ABC");
  });
  it("falls back to 'market' when the slug is empty", () => {
    expect(makeQuestionId("!!!", "xyz")).toBe("conviction-market-xyz");
  });
});

describe("yes/no gate (heuristic nudge)", () => {
  it("passes genuine binary questions", () => {
    expect(checkYesNo("Will ETH close above $5k this year?").ok).toBe(true);
    expect(checkYesNo("Is Everest a hit album?").ok).toBe(true);
    expect(checkYesNo("Base flips Arbitrum on TVL by Q4").ok).toBe(true); // a claim
  });
  it("nudges open-ended questions", () => {
    expect(checkYesNo("Who will win the election?").ok).toBe(false);
    expect(checkYesNo("How high will ETH go?").ok).toBe(false);
    expect(checkYesNo("What is the best L2?").ok).toBe(false);
  });
  it("nudges too-short and multi-part questions", () => {
    expect(checkYesNo("go?").ok).toBe(false);
    expect(checkYesNo("Will it rain? Will it snow?").ok).toBe(false);
  });
});

describe("seed math (USD displayed, wei sent)", () => {
  it("converts a USD stake to wei via the ETH price", () => {
    const wei = seedWeiFromUsd(2.14, 2140); // 0.001 ETH
    expect(Number(wei) / 1e18).toBeCloseTo(0.001, 6);
  });
  it("expresses the on-chain minimum in USD for display", () => {
    const minWei = 5_000_000_000_000_000n; // 0.005 ETH
    expect(minSeedUsd(minWei, 2000)).toBeCloseTo(10, 6);
  });
  it("gates a seed below the live minimum", () => {
    const min = 5_000_000_000_000_000n;
    expect(checkSeed(min, min)).toEqual({ ok: true, belowMin: false });
    expect(checkSeed(min - 1n, min)).toEqual({ ok: false, belowMin: true });
    expect(checkSeed(0n, min)).toEqual({ ok: false, belowMin: true });
  });
});

describe("inline balance guard", () => {
  it("requires seed + gas headroom", () => {
    const seed = 1_000_000_000_000_000n; // 0.001
    const head = 300_000_000_000_000n; // 0.0003
    expect(checkBalance(seed + head, seed, head)).toEqual({
      ok: true,
      requiredWei: seed + head,
    });
    expect(checkBalance(seed, seed, head).ok).toBe(false);
  });
});

describe("createMarket args — exact verified order", () => {
  it("assembles [questionId, yesAgent, noAgent, curve, yes] with V1 agent defaults", () => {
    const curve = "0x00000000000000000000000000000000000000c5" as const;
    expect(
      createMarketArgs({ questionId: "conviction-x-1", curve, yes: true }),
    ).toEqual(["conviction-x-1", V1_YES_AGENT, V1_NO_AGENT, curve, true]);
  });
  it("honors explicit agent overrides and the NO side", () => {
    const curve = "0x00000000000000000000000000000000000000c5" as const;
    expect(
      createMarketArgs({
        questionId: "q",
        yesAgent: "a",
        noAgent: "b",
        curve,
        yes: false,
      }),
    ).toEqual(["q", "a", "b", curve, false]);
  });
});

describe("near-duplicate detection", () => {
  it("scores heavy content-word overlap as similar", () => {
    expect(
      questionSimilarity("Will ETH flip BTC in 2026?", "Will ETH flip BTC by end of 2026?"),
    ).toBeGreaterThan(0.6);
    expect(isNearDuplicate("Is Everest a hit?", "Is Everest going to be a hit?")).toBe(true);
  });
  it("scores unrelated questions as dissimilar", () => {
    expect(isNearDuplicate("Will ETH flip BTC?", "Is Taylor Swift touring in Japan?")).toBe(false);
  });
  it("ignores stop-words so phrasing differences don't inflate similarity", () => {
    expect(questionSimilarity("the a is of", "will be to in")).toBe(0);
  });
});
