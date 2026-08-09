import { describe, it, expect } from "vitest";
import { insight } from "./insight";
import type { InsiderPulse } from "../types";

const pulse = (over: Partial<InsiderPulse> = {}): InsiderPulse => ({
  direction: "BALANCED",
  momentum: 0,
  acceleration: 0,
  activity: 0,
  participation: 0,
  capitalFlow: 0,
  imbalance: 0,
  volatility: 0,
  novelty: 0,
  lastInterestingEventAt: null,
  ...over,
});

describe("insider insight", () => {
  it("headline follows direction + momentum", () => {
    expect(insight(pulse({ direction: "YES", momentum: 0.9 })).headline).toBe("YES is gaining momentum.");
    expect(insight(pulse({ direction: "NO", momentum: 0.4 })).headline).toBe("NO is edging ahead.");
    expect(insight(pulse({ direction: "YES", momentum: 0.1 })).headline).toBe("YES leads, quietly.");
    expect(insight(pulse({ direction: "BALANCED", momentum: 0 })).headline).toBe("Holding steady.");
    expect(insight(pulse({ direction: "BALANCED", momentum: 0.5 })).headline).toBe("Both sides are live.");
  });

  it("detail names the strongest signals, capital clause knows the side", () => {
    const out = insight(pulse({ direction: "YES", momentum: 0.9, activity: 0.7, capitalFlow: 0.4 }));
    expect(out.detail).toBe(
      "Activity is well above this market's normal pace while capital is flowing to YES.",
    );
  });

  it("a quiet market says so plainly", () => {
    expect(insight(pulse()).detail).toBe("Little is moving right now.");
  });

  it("names at most two clauses", () => {
    const out = insight(
      pulse({ direction: "YES", activity: 0.9, capitalFlow: 0.9, participation: 0.9, acceleration: 0.9 }),
    );
    // Two clauses ⇒ exactly one " while " joiner.
    expect(out.detail.split(" while ")).toHaveLength(2);
  });

  it("carries the pulse and direction through", () => {
    const p = pulse({ direction: "NO", momentum: 0.7 });
    const out = insight(p);
    expect(out.direction).toBe("NO");
    expect(out.pulse).toBe(p);
  });
});
