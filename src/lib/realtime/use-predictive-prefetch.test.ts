import { describe, it, expect } from "vitest";
import { neighborIds } from "./use-predictive-prefetch";

describe("neighborIds", () => {
  const ids = [10, 20, 30, 40, 50];
  it("returns next, next+1, previous in that order", () => {
    expect(neighborIds(ids, 2)).toEqual([40, 50, 20]);
  });
  it("drops out-of-range neighbors at the ends", () => {
    expect(neighborIds(ids, 0)).toEqual([20, 30]); // no previous
    expect(neighborIds(ids, 4)).toEqual([40]); // no next / next+1
  });
  it("excludes the current id and dedupes", () => {
    expect(neighborIds([7, 7, 8], 0)).toEqual([8]); // ids[1]===current, ids[2]=8
  });
  it("returns [] for an invalid index or empty list", () => {
    expect(neighborIds(ids, -1)).toEqual([]);
    expect(neighborIds([], 0)).toEqual([]);
  });
});
