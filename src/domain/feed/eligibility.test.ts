import { describe, it, expect } from "vitest";
import { eligibilityFor, tierFor, type ExclusionReason } from "./eligibility";
import { COOLDOWNS } from "./config";

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const agoMs = (ms: number) => new Date(NOW - ms).toISOString();
const HOUR = 3_600_000;

const gate = (
  state: Parameters<typeof eligibilityFor>[0]["state"],
  o: {
    sessionSeen?: number[];
    sessionQueued?: number[];
    sessionSeenRank?: ReadonlyMap<number, number>;
  } = {},
) =>
  eligibilityFor({
    onchainId: 1,
    state,
    sessionSeen: new Set(o.sessionSeen ?? []),
    sessionQueued: new Set(o.sessionQueued ?? []),
    ...(o.sessionSeenRank ? { sessionSeenRank: o.sessionSeenRank } : {}),
    now: NOW,
  });

describe("the tier line: decided vs merely shown", () => {
  /**
   * THE WHOLE POINT OF THE CHANGE, asserted as a table rather than one case at a
   * time — the value of this rule is that it is exhaustive, and a table is the
   * only shape that stays exhaustive when someone adds a reason.
   */
  const expected: Record<ExclusionReason, "resurfaced" | "blocked"> = {
    active_position: "blocked",
    passed: "blocked",
    passed_repeat: "blocked",
    sold_out: "blocked",
    hidden: "blocked",
    queued_this_session: "blocked",
    recently_viewed: "resurfaced",
    recently_opened: "resurfaced",
    seen_this_session: "resurfaced",
  };

  for (const [reason, tier] of Object.entries(expected) as [
    ExclusionReason,
    "resurfaced" | "blocked",
  ][]) {
    it(`treats ${reason} as ${tier}`, () => {
      expect(tierFor(reason)).toBe(tier);
    });
  }

  it("a market with no history at all is fresh", () => {
    expect(tierFor(null)).toBe("fresh");
    const e = gate(undefined);
    expect(e).toMatchObject({ eligible: true, tier: "fresh", reason: null });
  });
});

describe("sightings come back", () => {
  it("a scroll-past is resurfaceable, not deleted", () => {
    const e = gate({ viewedAt: agoMs(HOUR) });
    expect(e.eligible).toBe(false);
    expect(e.tier).toBe("resurfaced");
    expect(e.reason).toBe("recently_viewed");
  });

  /**
   * THE REGRESSION THIS FILE EXISTS FOR. `seen_this_session` is restored from
   * sessionStorage on every page load and never expires, so as a hard exclusion
   * it could only shrink the feed — and reloading the tab shrank it further.
   */
  it("a session sighting is resurfaceable, so a reload cannot shrink the feed", () => {
    const e = gate(undefined, { sessionSeen: [1] });
    expect(e.tier).toBe("resurfaced");
    expect(e.reason).toBe("seen_this_session");
    expect(e.resurfaceAt).not.toBeNull();
  });

  it("an open case file comes back too, but behind every plain sighting", () => {
    const opened = gate({ openedAt: agoMs(HOUR) });
    const viewed = gate({ viewedAt: agoMs(HOUR) });
    expect(opened.tier).toBe("resurfaced");
    // Ascending resurfaceAt is the queue order: the 24h cooldown lifts later, so
    // the market they actually read follows the one they scrolled past.
    expect(opened.resurfaceAt!).toBeGreaterThan(viewed.resurfaceAt!);
  });
});

describe("decisions stay decisions", () => {
  it.each([
    ["an explicit hide", { hiddenAt: agoMs(HOUR) }, "hidden"],
    ["an open position", { activePosition: true }, "active_position"],
    ["a pass", { passedAt: agoMs(HOUR) }, "passed"],
    ["a second pass", { passedAt: agoMs(HOUR), passCount: 2 }, "passed_repeat"],
    ["a full exit", { soldAt: agoMs(HOUR) }, "sold_out"],
  ])("%s is blocked at every tier", (_label, state, reason) => {
    const e = gate(state);
    expect(e.tier).toBe("blocked");
    expect(e.reason).toBe(reason);
    expect(e.resurfaceAt).toBeNull();
  });

  it("a pass outranks the sighting that came with it", () => {
    // The reader both saw it and passed on it. The pass is the stronger
    // statement, so the reason must name it and the tier must obey it.
    const e = gate({ passedAt: agoMs(HOUR), viewedAt: agoMs(HOUR) }, { sessionSeen: [1] });
    expect(e.reason).toBe("passed");
    expect(e.tier).toBe("blocked");
  });

  it("a queued market is blocked — that is de-duplication, not history", () => {
    // Resurfacing it would put it on screen twice in one queue.
    const e = gate(undefined, { sessionQueued: [1] });
    expect(e.tier).toBe("blocked");
  });
});

describe("resurface ordering", () => {
  it("offers the oldest sighting first", () => {
    const old = eligibilityFor({
      onchainId: 1,
      state: { viewedAt: agoMs(7 * HOUR) },
      sessionSeen: new Set(),
      sessionQueued: new Set(),
      now: NOW,
    });
    const recent = eligibilityFor({
      onchainId: 2,
      state: { viewedAt: agoMs(HOUR) },
      sessionSeen: new Set(),
      sessionQueued: new Set(),
      now: NOW,
    });
    expect(old.resurfaceAt!).toBeLessThan(recent.resurfaceAt!);
  });

  it("ranks session sightings among themselves, oldest first", () => {
    const rank = new Map([
      [1, 0],
      [2, 5],
    ]);
    const first = gate(undefined, { sessionSeen: [1, 2], sessionSeenRank: rank });
    const later = eligibilityFor({
      onchainId: 2,
      state: undefined,
      sessionSeen: new Set([1, 2]),
      sessionQueued: new Set(),
      sessionSeenRank: rank,
      now: NOW,
    });
    expect(first.resurfaceAt!).toBeLessThan(later.resurfaceAt!);
  });

  /**
   * A session sighting carries no clock, so it is placed at the pessimistic end
   * of the viewed window rather than the optimistic one — otherwise the market
   * the reader scrolled past a second ago would be offered back ahead of one
   * they saw this morning.
   */
  it("puts an untimed session sighting behind a nearly-expired cooldown", () => {
    const nearlyExpired = eligibilityFor({
      onchainId: 2,
      state: { viewedAt: agoMs(COOLDOWNS.VIEWED_MS - 60_000) },
      sessionSeen: new Set(),
      sessionQueued: new Set(),
      now: NOW,
    });
    const untimed = gate(undefined, { sessionSeen: [1] });
    expect(untimed.resurfaceAt!).toBeGreaterThan(nearlyExpired.resurfaceAt!);
  });
});

describe("cooldowns still expire into freshness", () => {
  it("a sighting older than the window is fresh again, not resurfaced", () => {
    const e = gate({ viewedAt: agoMs(COOLDOWNS.VIEWED_MS + HOUR) });
    expect(e.tier).toBe("fresh");
    expect(e.eligible).toBe(true);
  });
});
