/**
 * THE HEARTBEAT LAYER'S INVARIANTS.
 *
 * One sentence governs all of them: silence may change whether an ordinary true
 * thing gets a slot right now, and may never change what anything MEANS.
 */
import { describe, expect, it } from "vitest";
import {
  DENSITY,
  admissionOf,
  adaptiveFloor,
  silenceAdjustedFloor,
} from "@/domain/feed-density";
import { scoreFeedEvent, type FeedCandidate } from "@/domain/feed-event";
import { PULSE, pulseReleaseCount } from "@/domain/pulse-release";
import { mixFeed, type MixCandidate } from "@/domain/feed-cadence";

const trade = (over: Partial<FeedCandidate> = {}): FeedCandidate =>
  ({
    kind: "trade",
    side: "YES",
    amountUsd: 12,
    walletCount: 1,
    tradeCount: 1,
    windowMs: null,
    relationship: null,
    marketBelievers: 60,
    conviction: null,
    daysHeld: null,
    ...over,
  }) as FeedCandidate;

describe("silence-adjusted floor", () => {
  it("is inert at zero pressure", () => {
    expect(silenceAdjustedFloor(25, 0)).toBe(25);
    expect(silenceAdjustedFloor(15, 0)).toBe(15);
  });

  it("never falls below the heartbeat floor, at any pressure", () => {
    for (const p of [0.5, 1, 2, 99]) {
      expect(silenceAdjustedFloor(25, p)).toBeGreaterThanOrEqual(DENSITY.pulseFloor);
      expect(silenceAdjustedFloor(15, p)).toBeGreaterThanOrEqual(DENSITY.pulseFloor);
    }
  });

  it("never raises the bar", () => {
    for (const p of [0, 0.25, 1]) expect(silenceAdjustedFloor(25, p)).toBeLessThanOrEqual(25);
  });
});

describe("pulse is comparative, not 'the floor was relaxed'", () => {
  it("a row that clears the standard bar is standard even under full pressure", () => {
    const big = trade({ amountUsd: 900 });
    const { floor } = adaptiveFloor([scoreFeedEvent(big).score]);
    expect(admissionOf(big, { floor, silenceFloor: silenceAdjustedFloor(floor, 1) })).toBe(
      "standard",
    );
  });

  it("a row that only clears the silence bar is pulse", () => {
    const small = trade({ amountUsd: 6, marketBelievers: 400 });
    const score = scoreFeedEvent(small).score;
    // Constructed so it sits between the two bars.
    const floor = score + 2;
    const silenceFloor = DENSITY.pulseFloor;
    expect(score).toBeGreaterThanOrEqual(silenceFloor);
    expect(admissionOf(small, { floor, silenceFloor })).toBe("pulse");
    // …and the same row at rest is simply not in the feed.
    expect(admissionOf(small, { floor, silenceFloor: floor })).toBe(null);
  });
});

describe("what silence can never buy", () => {
  it("dust never earns a slot of its own, at maximum pressure", () => {
    const dust = trade({ amountUsd: 0.02, marketBelievers: 400 });
    expect(
      admissionOf(dust, { floor: DENSITY.standard, silenceFloor: DENSITY.pulseFloor }),
    ).toBe(null);
  });

  it("a wash never comes back", () => {
    const wash = trade({ kind: "round_trip", amountUsd: 400 });
    expect(admissionOf(wash, { floor: DENSITY.standard, silenceFloor: 0 })).toBe(null);
  });

  it("a dead window stays empty however long the silence", () => {
    const nothing = [
      trade({ amountUsd: 0.01, marketBelievers: 500 }),
      trade({ kind: "round_trip", amountUsd: 900 }),
      trade({ amountUsd: 0.4, marketBelievers: 500 }),
    ];
    const bars = { floor: DENSITY.standard, silenceFloor: DENSITY.pulseFloor };
    expect(nothing.map((c) => admissionOf(c, bars))).toEqual([null, null, null]);
  });
});

describe("meaning is untouched by admission", () => {
  it("the same event scores identically in a busy and a quiet batch", () => {
    const c = trade({ amountUsd: 40 });
    const busy = adaptiveFloor([90, 80, 70, 60, 55, 50, 45, 40, 38, 35, 33, 31, 30, 29]);
    const quiet = adaptiveFloor([scoreFeedEvent(c).score]);
    expect(busy.floor).not.toBe(quiet.floor);
    // The gate moved; the measurement did not.
    expect(scoreFeedEvent(c)).toEqual(scoreFeedEvent(c));
  });
});

describe("the reader's clock, not the chain's", () => {
  const base = { silentForMs: PULSE.silentForMs + 1, freshSignalCount: 0, queued: 0 };

  it("releases a heartbeat only after real reader silence", () => {
    expect(pulseReleaseCount(base)).toBe(PULSE.perBatch);
    expect(pulseReleaseCount({ ...base, silentForMs: PULSE.silentForMs - 1 })).toBe(0);
  });

  it("never releases while anything real is arriving", () => {
    expect(pulseReleaseCount({ ...base, freshSignalCount: 1 })).toBe(0);
    expect(pulseReleaseCount({ ...base, queued: 1 })).toBe(0);
  });

  it("releases at most one at a time — a heartbeat is not a burst", () => {
    expect(pulseReleaseCount({ ...base, silentForMs: 60 * 60_000 })).toBe(1);
  });
});

describe("the mixer charges for a repeated heartbeat", () => {
  const row = (id: string, pulse: boolean): MixCandidate => ({
    id,
    family: "live_action",
    significance: 0.3,
    occurredAt: "2026-08-09T12:00:00.000Z",
    marketId: id,
    side: "YES",
    subjects: [`0x${id}`],
    motif: `trade:${id}`,
    voice: "receipt",
    pulse,
  });

  it("keeps intelligence above heartbeat", () => {
    const clue: MixCandidate = {
      ...row("clue", false),
      significance: 0.9,
      voice: "intelligence",
      signalGain: 0.8,
    };
    const out = mixFeed([row("a", true), clue, row("b", true)]);
    expect(out[0]!.id).toBe("clue");
  });

  it("penalises the second heartbeat relative to a non-pulse peer", () => {
    const out = mixFeed([row("p1", true), row("p2", true), row("s1", false)]);
    // The plain receipt is not last: one heartbeat speaks, then the ordinary
    // row, then the second heartbeat.
    expect(out.at(-1)!.pulse).toBe(true);
  });
});
