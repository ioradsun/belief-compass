import { describe, it, expect } from "vitest";
import { pulse, battle, crowd, marketVitals, marketBadge } from "./market-vitals";

describe("pulse — is the market alive? (honest, turnover-gated)", () => {
  it("high turnover reads as alive, with the no-math story line", () => {
    // $985 traded against $258 still held ≈ 3.8×
    const p = pulse(985, 258);
    expect(p.level).toBe("alive");
    expect(p.emoji).toBe("🔥");
    expect(p.line).toBe(
      "This market is alive — money has changed hands 3.8× more than is currently held.",
    );
    expect(p.healthPct).toBeGreaterThan(70);
  });

  it("pool ≈ volume reads as a flatline — never fake 'alive'", () => {
    // $276 traded against $264 still held ≈ 1.05×
    const p = pulse(276, 264);
    expect(p.level).toBe("flatline");
    expect(p.emoji).toBe("💔");
    expect(p.line).toMatch(/hasn't been tested/);
    expect(p.healthPct).toBeLessThan(15);
  });

  it("claims no pulse when nothing is backing the belief", () => {
    const p = pulse(0, 0);
    expect(p.level).toBe("flatline");
    expect(p.turnover).toBeNull();
    expect(p.healthPct).toBe(0);
  });

  it("health bar is bounded 0..100", () => {
    for (const [v, pool] of [
      [0, 100],
      [100000, 100],
      [50, 100],
    ] as const) {
      const h = pulse(v, pool).healthPct;
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThanOrEqual(100);
    }
  });
});

describe("battle — how split are the sides?", () => {
  it("a dead heat is neck and neck, peak intensity", () => {
    const b = battle(52);
    expect(b.label).toBe("Neck and neck");
    expect(b.splitLabel).toBe("52% / 48%");
    expect(b.intensity).toBe(96);
  });
  it("a landslide is one-sided, low intensity", () => {
    const b = battle(93);
    expect(b.label).toBe("YES dominates");
    expect(b.intensity).toBeLessThan(20);
  });
  it("no data → honest empty state, never a guessed split", () => {
    const b = battle(null);
    expect(b.splitLabel).toBe("—");
    expect(b.intensity).toBe(0);
  });
});

describe("crowd — believers, counted honestly", () => {
  it("scales the label with the count", () => {
    expect(crowd(0).label).toBe("No believers yet");
    expect(crowd(3).label).toBe("Just forming");
    expect(crowd(40).label).toBe("Busy");
    expect(crowd(412).label).toBe("Packed");
    expect(crowd(412).count).toBe(412);
  });
});

describe("marketVitals — the four signs in one story", () => {
  it("assembles pulse / crowd / conviction / battle", () => {
    const v = marketVitals({
      volumeUsd: 985,
      yesCapitalUsd: 140,
      noCapitalUsd: 118,
      believers: 412,
      yesPct: 52,
    });
    expect(v.pulse.level).toBe("alive");
    expect(v.crowd.count).toBe(412);
    expect(v.conviction.capitalUsd).toBe(258);
    expect(v.battle.label).toBe("Neck and neck");
  });
});

describe("marketBadge — one badge, only when earned", () => {
  it("high circulation → Battlefield", () => {
    expect(
      marketBadge({
        volumeUsd: 985,
        yesCapitalUsd: 140,
        noCapitalUsd: 118,
        believers: 10,
        yesPct: 52,
      })?.label,
    ).toBe("Battlefield");
  });
  it("pool ≈ volume → Ghost Town", () => {
    expect(
      marketBadge({
        volumeUsd: 276,
        yesCapitalUsd: 130,
        noCapitalUsd: 134,
        believers: 3,
        yesPct: 50,
      })?.label,
    ).toBe("Ghost Town");
  });
  it("Diamond Hands needs BOTH high circulation and a long hold — never invented", () => {
    const base = {
      volumeUsd: 985,
      yesCapitalUsd: 140,
      noCapitalUsd: 118,
      believers: 10,
      yesPct: 52,
    };
    expect(marketBadge({ ...base })?.label).toBe("Battlefield"); // no hold data → not Diamond
    expect(marketBadge({ ...base, avgHoldDays: 60 })?.label).toBe("Diamond Hands");
  });
  it("Founder's Corner only when the creator share is provably dominant", () => {
    expect(
      marketBadge({
        volumeUsd: 50,
        yesCapitalUsd: 900,
        noCapitalUsd: 100,
        believers: 2,
        yesPct: 90,
        creatorCapitalShare: 0.9,
      })?.label,
    ).toBe("Founder's Corner");
  });
});
