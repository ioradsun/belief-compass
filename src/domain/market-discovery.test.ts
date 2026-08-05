import { describe, expect, it } from "vitest";
import { composeDiscoveryRow, compactUsd, marketStage } from "./market-discovery";

const NOW = Date.parse("2026-08-05T12:00:00Z");
const ago = (ms: number) => NOW - ms;
const DAY = 86_400_000;

const base = { nowMs: NOW, participants: 10, believers: 5, capitalUsd: 500 };

describe("marketStage", () => {
  it("is new when nobody ever traded", () => {
    expect(marketStage({ ...base, participants: 0, believers: 0, capitalUsd: 0 })).toBe("new");
  });

  it("is exited when everyone left", () => {
    expect(
      marketStage({ ...base, participants: 91, believers: 0, capitalUsd: 0, lastActivityAt: ago(DAY) }),
    ).toBe("exited");
  });

  it("treats sub-cent residue as no capital", () => {
    expect(marketStage({ ...base, believers: 0, capitalUsd: 0.004 })).toBe("exited");
  });

  it("is emerging for a young market with a couple of participants", () => {
    expect(
      marketStage({ ...base, participants: 2, firstActivityAt: ago(3600_000), lastActivityAt: ago(3600_000) }),
    ).toBe("emerging");
  });

  it("is growing when people arrived today", () => {
    expect(
      marketStage({ ...base, firstActivityAt: ago(30 * DAY), lastActivityAt: ago(2 * DAY), joined24h: 3 }),
    ).toBe("growing");
  });

  it("is active with steady, not-today participation", () => {
    expect(
      marketStage({ ...base, firstActivityAt: ago(30 * DAY), lastActivityAt: ago(3 * DAY) }),
    ).toBe("active");
  });

  it("cools then goes dormant as silence stretches", () => {
    expect(marketStage({ ...base, firstActivityAt: ago(60 * DAY), lastActivityAt: ago(10 * DAY) })).toBe("cooling");
    expect(marketStage({ ...base, firstActivityAt: ago(60 * DAY), lastActivityAt: ago(40 * DAY) })).toBe("dormant");
  });
});

describe("composeDiscoveryRow", () => {
  it("never exposes internal state names", () => {
    const r = composeDiscoveryRow({ ...base, participants: 0, believers: 0, capitalUsd: 0 });
    expect(r.story).toBe("Waiting for the first believer.");
    expect(r.participantsText).toBeNull();
    expect(r.capText).toBeNull();
  });

  it("distinguishes never-traded from everyone-exited", () => {
    const r = composeDiscoveryRow({ ...base, participants: 91, believers: 0, capitalUsd: 0 });
    expect(r.story).toBe("Waiting for the next believer.");
    expect(r.participantsText).toBe("91 participants");
    expect(r.capText).toBe("$0 market cap");
  });

  it("singularises a lone participant", () => {
    expect(composeDiscoveryRow({ ...base, participants: 1 }).participantsText).toBe("1 participant");
  });
});

describe("compactUsd", () => {
  it("stays readable at every scale", () => {
    expect(compactUsd(0)).toBe("$0");
    expect(compactUsd(9.4)).toBe("$9.40");
    expect(compactUsd(940)).toBe("$940");
    expect(compactUsd(18_240)).toBe("$18K");
    expect(compactUsd(1_400_000)).toBe("$1.4M");
  });
});
