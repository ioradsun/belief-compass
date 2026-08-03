import { describe, expect, it } from "vitest";
import { marketIdFromParam, marketPath, marketShareUrl, shareMessage, slugifyTitle } from "./share";

describe("shareMessage", () => {
  it("leads with the backed side (the strongest hook), even on media", () => {
    expect(shareMessage({ side: "YES", hasMedia: false })).toBe("I backed YES. Stand on business.");
    expect(shareMessage({ side: "NO", hasMedia: true })).toBe("I backed NO. Stand on business.");
  });
  it("invites a watch on a media market with no side yet", () => {
    expect(shareMessage({ side: null, hasMedia: true })).toBe(
      "Watch this. Pick a side. Stand on business.",
    );
  });
  it("asks for a side on a plain market", () => {
    expect(shareMessage({ side: null, hasMedia: false })).toBe("Pick a side. Stand on business.");
  });
});

describe("slugifyTitle", () => {
  it("makes a clean, url-safe slug", () => {
    expect(slugifyTitle("Will ETH hit $5,000 by July?")).toBe("will-eth-hit-5-000-by-july");
    expect(slugifyTitle("  Multiple   spaces & symbols!! ")).toBe("multiple-spaces-symbols");
  });
  it("is empty when there is nothing usable", () => {
    expect(slugifyTitle("")).toBe("");
    expect(slugifyTitle("!!! ???")).toBe("");
    expect(slugifyTitle(null)).toBe("");
  });
  it("caps length without slicing a word mid-way", () => {
    const s = slugifyTitle("one two three four five six seven eight nine ten eleven twelve", 20);
    expect(s.length).toBeLessThanOrEqual(20);
    expect(s.endsWith("-")).toBe(false);
    expect(s.startsWith("one-two")).toBe(true);
  });
});

describe("marketPath / marketIdFromParam", () => {
  it("is id-led and human-readable, and round-trips the id", () => {
    const p = marketPath(42, "Will ETH hit $5k?");
    expect(p).toBe("/m/42-will-eth-hit-5k");
    expect(marketIdFromParam(p.replace("/m/", ""))).toBe(42);
  });
  it("falls back to the id alone when the title has no slug", () => {
    expect(marketPath(7, "???")).toBe("/m/7");
    expect(marketPath(7, null)).toBe("/m/7");
  });
  it("parses the id even from a slug the title later changed", () => {
    expect(marketIdFromParam("42-a-totally-different-title")).toBe(42);
    expect(marketIdFromParam("bad")).toBeNull();
    expect(marketIdFromParam(null)).toBeNull();
  });
});

describe("marketShareUrl", () => {
  it("builds a clean canonical URL, trimming a trailing slash on origin", () => {
    expect(marketShareUrl("https://conviction.company/", 42, "ETH $5k")).toBe(
      "https://conviction.company/m/42-eth-5k",
    );
  });
  it("appends the attribution ref only when present", () => {
    expect(marketShareUrl("https://conviction.company", 42, "ETH $5k", "abc123")).toBe(
      "https://conviction.company/m/42-eth-5k?r=abc123",
    );
    expect(marketShareUrl("https://conviction.company", 42, "ETH $5k", null)).toBe(
      "https://conviction.company/m/42-eth-5k",
    );
  });
});
