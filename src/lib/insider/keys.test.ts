import { describe, it, expect } from "vitest";
import {
  insiderMarketKey,
  insiderNowKey,
  insiderNowRootKey,
  insiderPulseKey,
  insiderPulseRootKey,
  insiderRootKey,
} from "./keys";

describe("insider cache keys", () => {
  it("gives the side rails and the Market Insider rail the SAME key", () => {
    // The whole point of step 3 survives only if the key is side-blind.
    expect(insiderMarketKey(2776, { wallet: "0xabc", limit: 200 })).toEqual(
      insiderMarketKey(2776, { wallet: "0xabc", limit: 200 }),
    );
  });

  it("separates markets, viewers and the global feed", () => {
    expect(insiderMarketKey(1, { wallet: null, limit: 200 })).not.toEqual(
      insiderMarketKey(2, { wallet: null, limit: 200 }),
    );
    expect(insiderNowKey({ wallet: "0xa" })).not.toEqual(insiderNowKey({ wallet: null }));
    expect(insiderNowKey({ limit: 120 })).not.toEqual(insiderNowKey({ limit: 60 }));
  });

  it("hangs every scope off the one invalidation root", () => {
    const root = insiderRootKey()[0];
    expect(insiderNowKey({})[0]).toBe(root);
    expect(insiderMarketKey(9, { limit: 200 })[0]).toBe(root);
  });

  it("normalises absent viewer/side/limit so keys are stable", () => {
    expect(insiderNowKey({})).toEqual(insiderNowKey({ wallet: null, side: null, limit: null }));
  });
});

describe("insider pulse keys", () => {
  it("carries the batch spec so realtime can target it", () => {
    expect(insiderPulseKey([12, 45, 88])).toEqual(["insider", "pulse", "12,45,88"]);
    expect(insiderPulseKey("42")).toEqual(insiderPulseKey([42]));
  });

  it("keeps the global feed and the pulse batches separately invalidatable", () => {
    expect(insiderNowRootKey()).not.toEqual(insiderPulseRootKey());
    expect(insiderNowRootKey()[0]).toBe(insiderPulseRootKey()[0]);
  });
});
