import { describe, it, expect } from "vitest";
import { eligibilityFor, tierFor, type ExclusionReason } from "./eligibility";

const NOW = Date.UTC(2026, 0, 15, 12, 0, 0);
const HOUR = 3_600_000;
const agoMs = (ms: number) => new Date(NOW - ms).toISOString();

/** The pass began an hour ago unless a case says otherwise. */
const CYCLE = NOW - HOUR;

const gate = (
  state: Parameters<typeof eligibilityFor>[0]["state"],
  o: {
    sessionSeen?: number[];
    sessionQueued?: number[];
    cycleStartedAt?: number;
  } = {},
) =>
  eligibilityFor({
    onchainId: 1,
    state,
    sessionSeen: new Set(o.sessionSeen ?? []),
    sessionQueued: new Set(o.sessionQueued ?? []),
    cycleStartedAt: o.cycleStartedAt ?? CYCLE,
    now: NOW,
  });

describe("one rule: touched in this pass is out of this pass", () => {
  /**
   * Every reason is now the SAME kind of answer — there is no second tier to
   * fall into, and a table is what keeps that true when someone adds a reason.
   */
  const reasons: ExclusionReason[] = [
    "active_position",
    "passed",
    "passed_repeat",
    "sold_out",
    "hidden",
    "queued_this_session",
    "recently_viewed",
    "recently_opened",
    "seen_this_session",
  ];

  for (const reason of reasons) {
    it(`treats ${reason} as blocked`, () => {
      expect(tierFor(reason)).toBe("blocked");
    });
  }

  it("a market with no history at all is fresh", () => {
    expect(tierFor(null)).toBe("fresh");
    expect(gate(undefined)).toMatchObject({ eligible: true, tier: "fresh", reason: null });
  });

  it.each([
    ["an explicit hide", { hiddenAt: agoMs(60_000) }, "hidden"],
    ["an open position", { activePosition: true }, "active_position"],
    ["a pass", { passedAt: agoMs(60_000) }, "passed"],
    ["a second pass", { passedAt: agoMs(60_000), passCount: 2 }, "passed_repeat"],
    ["a full exit", { soldAt: agoMs(60_000) }, "sold_out"],
    ["a case file opened", { openedAt: agoMs(60_000) }, "recently_opened"],
    ["a scroll-past", { viewedAt: agoMs(60_000) }, "recently_viewed"],
  ])("%s inside the pass is out of it", (_label, state, reason) => {
    const e = gate(state);
    expect(e.eligible).toBe(false);
    expect(e.tier).toBe("blocked");
    expect(e.reason).toBe(reason);
  });

  it("a pass outranks the sighting that came with it", () => {
    const e = gate({ passedAt: agoMs(60_000), viewedAt: agoMs(60_000) }, { sessionSeen: [1] });
    expect(e.reason).toBe("passed");
  });

  it("the client's own record covers a sighting the ledger has not stored yet", () => {
    expect(gate(undefined, { sessionSeen: [1] }).reason).toBe("seen_this_session");
  });

  it("a market already queued later in the run is not queued twice", () => {
    expect(gate(undefined, { sessionQueued: [1] }).reason).toBe("queued_this_session");
  });
});

describe("rolling the pass re-admits everything", () => {
  /**
   * THE REGRESSION THIS FILE EXISTS FOR: contact used to expire on a per-reason
   * clock, so the same history produced different feeds depending on which timer
   * had run out. Now there is one boundary, and it is the pass.
   */
  it.each([
    ["a sighting", { viewedAt: agoMs(3 * HOUR) }],
    ["an opened case file", { openedAt: agoMs(3 * HOUR) }],
    ["a pass", { passedAt: agoMs(3 * HOUR), passCount: 3 }],
    ["a full exit", { soldAt: agoMs(3 * HOUR) }],
    ["a position taken before the pass", { activePosition: true, positionAt: agoMs(3 * HOUR) }],
  ])("%s from a spent pass is fresh again", (_label, state) => {
    const e = gate(state);
    expect(e.eligible).toBe(true);
    expect(e.tier).toBe("fresh");
  });

  it("a hide is the one thing a new pass does not undo", () => {
    expect(gate({ hiddenAt: agoMs(3 * HOUR) }).reason).toBe("hidden");
  });

  it("a position with no known trade time stays out until it is sold", () => {
    // No timestamp means no way to say which pass it belongs to; the safe
    // reading of "you are holding this right now" is that it is current.
    expect(gate({ activePosition: true }).reason).toBe("active_position");
  });

  it("with no pass boundary at all, every recorded contact still counts", () => {
    const e = eligibilityFor({
      onchainId: 1,
      state: { viewedAt: agoMs(400 * HOUR) },
      sessionSeen: new Set(),
      sessionQueued: new Set(),
      now: NOW,
    });
    expect(e.eligible).toBe(false);
  });
});
