import { describe, it, expect } from "vitest";
import {
  fmtUsd,
  wealthFlow,
  aliasFor,
  attributionVerb,
  rankScore,
  pricePctText,
  initialsFor,
  hueFor,
  avatarRef,
  relationshipBucket,
  relationshipColor,
  relationshipStrength,
  isOpposed,
  RELATIONSHIP_COLOR,
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

describe("relationship ring — alignment ↔ opposition spectrum", () => {
  it("buckets the score symmetrically around neutral (50)", () => {
    expect(relationshipBucket(95)).toBe("strong-align");
    expect(relationshipBucket(90)).toBe("strong-align");
    expect(relationshipBucket(78)).toBe("moderate-align");
    expect(relationshipBucket(55)).toBe("neutral");
    expect(relationshipBucket(45)).toBe("neutral");
    expect(relationshipBucket(20)).toBe("moderate-oppose");
    expect(relationshipBucket(5)).toBe("strong-oppose");
  });
  it("never uses green/yellow for opposition — only purple↔grey↔red", () => {
    // Opposition is signal, not a warning; green/red are reserved for P&L.
    const green = /#?(0f0|00ff00|22c55e|16a34a|4ade80)/i;
    for (const hex of Object.values(RELATIONSHIP_COLOR)) {
      expect(green.test(hex)).toBe(false);
    }
    expect(relationshipColor(95)).toBe(RELATIONSHIP_COLOR["strong-align"]); // purple
    expect(relationshipColor(5)).toBe(RELATIONSHIP_COLOR["strong-oppose"]); // red
  });
  it("strength fills the ring equally for both poles", () => {
    // A strong Opp is as visually present as strong People.
    expect(relationshipStrength(95)).toBeCloseTo(0.9, 5);
    expect(relationshipStrength(5)).toBeCloseTo(0.9, 5);
    expect(relationshipStrength(50)).toBe(0); // neutral = empty ring
  });
  it("opposition is the redundant non-hue channel", () => {
    expect(isOpposed(20)).toBe(true);
    expect(isOpposed(80)).toBe(false);
    expect(isOpposed(50)).toBe(false);
  });
});

describe("avatar helpers", () => {
  it("initialsFor takes first+last initial of a real name", () => {
    expect(initialsFor("ROI research")).toBe("RR");
    expect(initialsFor("Quiet River")).toBe("QR");
    expect(initialsFor("Cobie")).toBe("CO");
    expect(initialsFor("")).toBe("?");
  });
  it("hueFor is stable and in range", () => {
    const h = hueFor("0xAbC");
    expect(hueFor("0xabc")).toBe(h);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
  });
  it("avatarRef prefers a real profile, falls back to alias with no pic", () => {
    const withProfile = avatarRef("0x1", { displayName: "Cobie", pfpUrl: "https://x/y.jpg" });
    expect(withProfile.displayName).toBe("Cobie");
    expect(withProfile.pfpUrl).toBe("https://x/y.jpg");
    const bare = avatarRef("0x1");
    expect(bare.displayName).toBeNull();
    expect(bare.pfpUrl).toBeNull();
    expect(bare.alias).toBe(aliasFor("0x1"));
  });
});
