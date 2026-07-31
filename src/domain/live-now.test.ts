import { describe, expect, it } from "vitest";
import { eventSide, latestMarketEvent, liveNowLine } from "@/domain/live-now";
import type { TapeTrade } from "@/domain/conviction-series";

const now = 1_000_000_000_000;
const min = 60_000;
const buy = (w: string, side: "YES" | "NO", eth: number, t: number): TapeTrade => ({
  w,
  side,
  action: "BUY",
  eth,
  price: 1,
  t,
});

describe("latestMarketEvent", () => {
  it("is null on an empty market", () => {
    expect(latestMarketEvent([], now)).toBeNull();
  });

  it("returns the newest beat across both sides", () => {
    const tape = [
      buy("a", "YES", 1, now - 60 * min),
      buy("b", "NO", 1, now - 3 * min), // newest
    ];
    const e = latestMarketEvent(tape, now)!;
    expect(eventSide(e)).toBe("NO");
  });
});

describe("liveNowLine", () => {
  const money = (eth: number) => `$${Math.round(eth * 100)}`;

  it("reads capital as '$X entered SIDE'", () => {
    // Two NO buyers in one recent bucket → a capital beat on NO.
    const tape = [buy("a", "NO", 0.42, now - 4 * min), buy("b", "NO", 0.1, now - 4 * min)];
    const e = latestMarketEvent(tape, now)!;
    const line = liveNowLine(e, money);
    if (e.kind === "capital") expect(line.text).toMatch(/entered NO$/);
  });

  it("keeps the rail wording for believer beats", () => {
    const tape = [buy("a", "YES", 1, now - 2 * min), buy("b", "YES", 1, now - 2 * min)];
    const e = latestMarketEvent(tape, now)!;
    const line = liveNowLine(e, money);
    expect(line.text).toContain("joined YES");
  });
});
