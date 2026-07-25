import { describe, it, expect } from "vitest";
import {
  fmtUsd,
  wealthFlow,
  aliasFor,
  attributionVerb,
  rankScore,
  pricePctText,
} from "./conviction-feed";

describe("fmtUsd — dollars, human units", () => {
  it("scales M / k / plain", () => {
    expect(fmtUsd(8_400_000)).toBe("$8.4M");
    expect(fmtUsd(12_000_000)).toBe("$12M");
    expect(fmtUsd(842_000)).toBe("$842k");
    expect(fmtUsd(28_400)).toBe("$28k");
    expect(fmtUsd(180)).toBe("$180");
  });
});

describe("wealthFlow — tier-1 capital flow, honest verbs", () => {
  it("uses entered/left for a sided flow and never implies profit", () => {
    expect(wealthFlow(8_400_000, "in", "YES")?.text).toBe("$8.4M entered YES");
    expect(wealthFlow(2_700_000, "out", "NO")?.text).toBe("$2.7M left NO");
  });
  it("network scale (no side) uses the weakest verb", () => {
    expect(wealthFlow(2_400_000, "in", null)?.text).toBe("$2.4M committed today");
  });
  it("returns null for a zero/absent figure (no fake hook)", () => {
    expect(wealthFlow(0, "in", "YES")).toBeNull();
  });
  it("is always tier 'flow' — never claims realized/unrealized here", () => {
    expect(wealthFlow(1000, "in", "YES")?.tier).toBe("flow");
  });
});

describe("attributionVerb — earned, weakest-true by default", () => {
  it("defaults to 'joined' with no evidence", () => {
    expect(attributionVerb(null)).toBe("joined the buyers");
  });
  it("climbs to 'drove' only when acted before AND materially large", () => {
    expect(attributionVerb({ shareOfMove: 0.3, actedBefore: true, actedDuring: false })).toBe(
      "drove the move",
    );
  });
  it("does not claim 'drove' on thin evidence", () => {
    expect(attributionVerb({ shareOfMove: 0.05, actedBefore: true, actedDuring: false })).toBe(
      "joined the buyers",
    );
  });
  it("'accelerated' needs acting during the move", () => {
    expect(attributionVerb({ shareOfMove: 0.2, actedBefore: false, actedDuring: true })).toBe(
      "accelerated the move",
    );
  });
});

describe("aliasFor — deterministic, stable, non-evaluative", () => {
  it("is stable for the same wallet and case-insensitive", () => {
    const a = aliasFor("0xAbC123");
    expect(aliasFor("0xabc123")).toBe(a);
    expect(a.split(" ")).toHaveLength(2);
  });
  it("never emits an evaluative reputation word", () => {
    const banned = /rich|smart|lucky|winner|whale|genius|poor|dumb/i;
    for (let i = 0; i < 500; i++) {
      expect(banned.test(aliasFor(`0x${i.toString(16).padStart(40, "0")}`))).toBe(false);
    }
  });
});

describe("rankScore — money first, with overrides", () => {
  it("more wealth outranks less, all else equal", () => {
    const base = { attribution: 1, meaningful: 0, surprise: 0, ageHours: 1 };
    expect(rankScore({ ...base, wealthUsd: 2_000_000 })).toBeGreaterThan(
      rankScore({ ...base, wealthUsd: 1_000 }),
    );
  });
  it("People+Opp convergence overrides even a big unattributed move", () => {
    const convergence = rankScore({
      wealthUsd: 1_000,
      attribution: 4,
      meaningful: 1,
      surprise: 1,
      ageHours: 0,
      convergence: true,
    });
    const bigMove = rankScore({
      wealthUsd: 5_000_000,
      attribution: 1,
      meaningful: 0,
      surprise: 0,
      ageHours: 0,
    });
    expect(convergence).toBeGreaterThan(bigMove);
  });
  it("unattributed moves rank below an attributed move of equal wealth", () => {
    const attributed = rankScore({
      wealthUsd: 100_000,
      attribution: 4,
      meaningful: 0,
      surprise: 0,
      ageHours: 0,
    });
    const unattributed = rankScore({
      wealthUsd: 100_000,
      attribution: 0,
      meaningful: 0,
      surprise: 0,
      ageHours: 0,
      unattributed: true,
    });
    expect(unattributed).toBeLessThan(attributed);
  });
});

describe("pricePctText", () => {
  it("signs the change and pairs it with the side", () => {
    expect(pricePctText("YES", 38)).toBe("YES +38%");
    expect(pricePctText("NO", -18)).toBe("NO -18%");
    expect(pricePctText(null, 5)).toBeNull();
  });
});
