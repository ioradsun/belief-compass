import { describe, it, expect } from "vitest";
import { ownedPositions, sellStep, heldSide, dockSurface } from "./order-actions";

const own = (yes: bigint, no: bigint, yesW?: number | null, noW?: number | null) =>
  ownedPositions({ yesTokens: yes, noTokens: no, yesWorthUsd: yesW, noWorthUsd: noW });

describe("ownedPositions", () => {
  it("reports nothing owned", () => {
    const o = own(0n, 0n);
    expect(o.any).toBe(false);
    expect(o.both).toBe(false);
    expect(o.only).toBeNull();
    expect(o.yes).toBeNull();
    expect(o.no).toBeNull();
  });

  it("reports a single YES holding", () => {
    const o = own(5n, 0n, 24.1);
    expect(o.any).toBe(true);
    expect(o.both).toBe(false);
    expect(o.only).toBe("YES");
    expect(o.yes).toEqual({ side: "YES", tokens: 5n, worthUsd: 24.1 });
    expect(o.no).toBeNull();
  });

  it("reports a single NO holding", () => {
    const o = own(0n, 7n, null, 9.3);
    expect(o.only).toBe("NO");
    expect(o.no).toEqual({ side: "NO", tokens: 7n, worthUsd: 9.3 });
  });

  // The case the old single-`held` model erased: YES won and the NO holding
  // became invisible AND unsellable.
  it("keeps BOTH holdings when both sides are held", () => {
    const o = own(5n, 7n, 24.1, 9.3);
    expect(o.both).toBe(true);
    expect(o.any).toBe(true);
    expect(o.only).toBeNull();
    expect(o.yes?.tokens).toBe(5n);
    expect(o.no?.tokens).toBe(7n);
  });

  it("treats missing balances as not owned", () => {
    const o = ownedPositions({ yesTokens: null, noTokens: undefined });
    expect(o.any).toBe(false);
  });

  it("owns on TOKENS, not on a price being known", () => {
    const o = own(3n, 0n, null);
    expect(o.yes).toEqual({ side: "YES", tokens: 3n, worthUsd: null });
    expect(o.only).toBe("YES");
  });
});

describe("sellStep — never ask a question with one answer", () => {
  it("has nothing to sell when nothing is owned", () => {
    expect(sellStep(own(0n, 0n))).toEqual({ kind: "none" });
  });

  it("goes straight to the only side owned", () => {
    expect(sellStep(own(5n, 0n))).toEqual({ kind: "direct", side: "YES" });
    expect(sellStep(own(0n, 5n))).toEqual({ kind: "direct", side: "NO" });
  });

  it("asks which side when both are owned", () => {
    expect(sellStep(own(5n, 7n))).toEqual({ kind: "choose" });
  });
});

describe("heldSide", () => {
  it("looks up either side independently", () => {
    const o = own(5n, 7n, 24.1, 9.3);
    expect(heldSide(o, "YES")?.worthUsd).toBe(24.1);
    expect(heldSide(o, "NO")?.worthUsd).toBe(9.3);
  });

  it("returns null for a side not held", () => {
    expect(heldSide(own(5n, 0n), "NO")).toBeNull();
  });
});

describe("dockSurface — desktop and phone agree on what you're looking at", () => {
  it("shows the plain buy ticket when nothing is owned", () => {
    expect(dockSurface({ owned: own(0n, 0n), selling: false, buySide: null })).toBe("buy");
  });

  it("shows ownership + the stable selector when you hold something", () => {
    expect(dockSurface({ owned: own(5n, 0n), selling: false, buySide: null })).toBe("owned");
    expect(dockSurface({ owned: own(0n, 5n), selling: false, buySide: null })).toBe("owned");
    expect(dockSurface({ owned: own(5n, 7n), selling: false, buySide: null })).toBe("owned");
  });

  it("hands the dock to the buy ticket once a side is chosen, even while holding", () => {
    // The regression this rule exists to prevent: tapping Back YES while you
    // already own shares must open the amount form, not bounce to the selector.
    expect(dockSurface({ owned: own(5n, 7n), selling: false, buySide: "YES" })).toBe("buy");
    expect(dockSurface({ owned: own(0n, 0n), selling: false, buySide: "NO" })).toBe("buy");
  });

  it("lets an in-flight sell outrank everything", () => {
    expect(dockSurface({ owned: own(5n, 0n), selling: true, buySide: null })).toBe("sell");
    expect(dockSurface({ owned: own(5n, 0n), selling: true, buySide: "YES" })).toBe("sell");
  });
});
