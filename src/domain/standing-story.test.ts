import { describe, it, expect } from "vitest";
import { findStandingIntelligence, type StandingEvidence } from "./standing-story";
import type { StandingHolder } from "./standing-fact";

const holder = (wallet: string, daysHeld: number, floor = false): StandingHolder => ({
  wallet,
  name: wallet,
  avatarUrl: null,
  daysHeld,
  tenureIsFloor: floor,
  positionUsd: 100,
});

const evidence = (o: Partial<StandingEvidence>): StandingEvidence => ({
  marketId: 42,
  marketTitle: "A question",
  side: "YES",
  holders: [holder("a", 16, true), holder("b", 10), holder("c", 8)],
  sidePriceChange24h: 0.26,
  oppositeBelievers: 3,
  exits: 0,
  capitalDelta24h: 0,
  whale: null,
  ...o,
});

describe("THEY DIDN'T BUDGE never doubles the tenure floor or overclaims the group", () => {
  const budge = () =>
    findStandingIntelligence(evidence({})).find((r) => r.kind === "held_through_price_move");

  it("attributes the age to the oldest position, not all of them", () => {
    const r = budge();
    expect(r?.headline).toBe("THEY DIDN'T BUDGE");
    expect(r?.body).toBe("YES rose 26%. 3 positions, the oldest held 16+ days, are still there.");
  });

  it("prints the floor once — never '16+ days or more'", () => {
    const body = budge()?.body ?? "";
    expect(body).not.toMatch(/or more/);
    expect(body).not.toMatch(/\+ days or/);
  });
});
