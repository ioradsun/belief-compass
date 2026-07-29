import { describe, expect, it } from "vitest";
import { tribeWelcome, tribeShareText } from "@/domain/tribe";

describe("tribeWelcome", () => {
  it("names the side in the headline", () => {
    expect(tribeWelcome("YES", 5).headline).toBe("Welcome to the YES Tribe");
    expect(tribeWelcome("NO", 5).headline).toBe("Welcome to the NO Tribe");
  });

  it("treats 0 or 1 as the first believer (never lonely)", () => {
    for (const n of [null, undefined, 0, 1]) {
      const w = tribeWelcome("YES", n as number);
      expect(w.message[0]).toBe("You're the first believer.");
      expect(w.cta).toBe("Invite the next believer");
    }
  });

  it("frames 2–10 as one of the first believers", () => {
    for (const n of [2, 7, 10]) {
      const w = tribeWelcome("NO", n);
      expect(w.message[0]).toBe("You're one of the first believers.");
      expect(w.cta).toBe("Grow the Tribe");
    }
  });

  it("shows the count standing with you for 11–99", () => {
    const w = tribeWelcome("YES", 23);
    expect(w.message[0]).toBe("23 believers stand with you.");
    expect(w.message[1]).toBe("Your conviction is attracting others.");
    expect(w.cta).toBe("Grow the Tribe");
  });

  it("formats large counts with thousands separators", () => {
    const w = tribeWelcome("NO", 1482);
    expect(w.message[0]).toBe("1,482 believers stand with you.");
    expect(w.cta).toBe("Share My Conviction");
  });

  it("never exposes finance in the share text", () => {
    const t = tribeShareText("YES");
    expect(t).toContain("YES");
    expect(t.toLowerCase()).not.toMatch(/\$|price|pnl|profit|wallet|0x/);
  });
});
