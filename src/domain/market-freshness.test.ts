import { describe, expect, it } from "vitest";
import { marketFreshness } from "@/domain/market-freshness";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("marketFreshness", () => {
  it("follows the deterministic ladder", () => {
    expect(marketFreshness(5 * MIN)).toEqual({ token: "FRESHLY CREATED", fresh: true });
    expect(marketFreshness(45 * MIN)).toEqual({ token: "FRESH", fresh: true });
    expect(marketFreshness(6 * HOUR)).toEqual({ token: "NEW TODAY", fresh: true });
    expect(marketFreshness(2 * DAY).token).toBe("2D OLD");
    expect(marketFreshness(8 * DAY).token).toBe("8D OLD");
    expect(marketFreshness(60 * DAY).token).toBe("2MO OLD");
    expect(marketFreshness(400 * DAY).token).toBe("1Y OLD");
  });

  it("is fresh only under a day", () => {
    expect(marketFreshness(23 * HOUR).fresh).toBe(true);
    expect(marketFreshness(25 * HOUR).fresh).toBe(false);
    expect(marketFreshness(2 * DAY).fresh).toBe(false);
  });

  it("never renders '0D OLD' at the day boundary", () => {
    expect(marketFreshness(DAY).token).toBe("1D OLD");
  });

  it("clamps negative/future ages to freshly created", () => {
    expect(marketFreshness(-5000)).toEqual({ token: "FRESHLY CREATED", fresh: true });
  });
});
