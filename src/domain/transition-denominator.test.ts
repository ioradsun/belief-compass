import { describe, it, expect } from "vitest";
import { retellTransition, DUST_USD, MATERIAL_USD } from "./transition-denominator";

const K = "k1";

describe("a percentage never travels without its denominator", () => {
  it("says the dollars when real money left, not the percentage", () => {
    const r = retellTransition("Money is leaving YES", "−100% over 24H", K, {
      usd: 147,
      side: "YES",
    });
    expect(r.detail).toBe("The entire $147 behind YES left today.");
    expect(r.detail).not.toMatch(/%/);
    expect(r.level).toBe("observation");
  });

  it("drops the percentage entirely when it is arithmetic on pocket change", () => {
    const r = retellTransition("Money is leaving YES", "−100% over 24H", K, {
      usd: 1.8,
      side: "YES",
    });
    expect(r.detail).toBe("Only $1.80 was behind it, and it left.");
    expect(r.headline).not.toMatch(/empt/i);
    expect(r.level).toBe("receipt");
  });

  it("refuses to shout a percentage it cannot size", () => {
    const r = retellTransition("Money is leaving YES", "−100% over 24H", K, {
      usd: null,
      side: "YES",
    });
    expect(r.level).toBe("receipt");
  });

  it("treats the middle as true but quiet", () => {
    const mid = (MATERIAL_USD + DUST_USD) / 2;
    const r = retellTransition("Money is leaving NO", "−65% over 24H", K, { usd: mid, side: "NO" });
    expect(r.detail).toBe("$15 left NO today.");
    expect(r.level).toBe("receipt");
  });

  it("reads capital arriving the same way", () => {
    const r = retellTransition("Money is piling into YES", "+94% over 24H", K, {
      usd: 320,
      side: "YES",
    });
    expect(r.detail).toBe("$320 arrived on YES today.");
    expect(r.level).toBe("observation");
  });

  it("never claims a dollar figure that was not supplied", () => {
    for (const usd of [null, 0, Number.NaN]) {
      const r = retellTransition("Money is leaving YES", "−83% over 24H", K, { usd, side: "YES" });
      expect(r.detail).not.toMatch(/\$/);
    }
  });
});

describe("a structural announcement with nothing else to add is a receipt", () => {
  it("demotes first-believers rows", () => {
    const r = retellTransition("YES has its first believers", null, K, { usd: null, side: "YES" });
    expect(r.headline).toBe("YES just got company");
    expect(r.level).toBe("receipt");
  });

  it("keeps a row that actually carries a figure at observation volume", () => {
    const r = retellTransition("More believers. Less capital.", "9 people joined while $85 left the market.", K, {
      usd: null,
      side: null,
    });
    expect(r.detail).toBe("9 people joined while $85 left the market.");
    expect(r.level).toBe("observation");
  });

  it("leaves unrecognised copy untouched", () => {
    const r = retellTransition("Something new", "A sentence.", K, { usd: null, side: null });
    expect(r.headline).toBe("Something new");
    expect(r.detail).toBe("A sentence.");
  });
});
