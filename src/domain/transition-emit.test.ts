import { describe, it, expect } from "vitest";
import { decideTransitionEmit, TRANSITION_EMIT, type TransitionStore } from "./transition-emit";

const T0 = 1_000_000_000_000;
const PERSIST = TRANSITION_EMIT.minPersistMs;

const store = (over: Partial<TransitionStore>): TransitionStore => ({
  fingerprint: "accelerating:YES",
  firstSeenAt: T0,
  lastSeenAt: T0,
  lastEmittedAt: null,
  seenCount: 1,
  ...over,
});

describe("flicker guard — a state must persist before it emits", () => {
  it("does not emit on first observation", () => {
    const d = decideTransitionEmit({
      current: { fingerprint: "accelerating:YES", tier: 2 },
      stored: null,
      nowMs: T0,
    });
    expect(d.emit).toBe(false);
    expect(d.reason).toBe("new-episode");
    expect(d.state?.seenCount).toBe(1);
  });

  it("emits on the second observation once it has also persisted long enough", () => {
    const first = store({ seenCount: 1, firstSeenAt: T0 });
    const d = decideTransitionEmit({
      current: { fingerprint: "accelerating:YES", tier: 2 },
      stored: first,
      nowMs: T0 + PERSIST,
    });
    expect(d.emit).toBe(true);
    expect(d.reason).toBe("emit");
    expect(d.state?.lastEmittedAt).toBe(T0 + PERSIST);
    expect(d.state?.seenCount).toBe(2);
  });

  it("holds a second observation that came too soon (time not yet elapsed)", () => {
    const d = decideTransitionEmit({
      current: { fingerprint: "accelerating:YES", tier: 2 },
      stored: store({ seenCount: 1, firstSeenAt: T0 }),
      nowMs: T0 + 1_000,
    });
    expect(d.emit).toBe(false);
    expect(d.reason).toBe("flicker-guard");
  });

  it("a fingerprint that flips away restarts the persistence clock (never emits the flicker)", () => {
    // Was observed once as A, now reads B → new episode, no emit.
    const d = decideTransitionEmit({
      current: { fingerprint: "market_dividing:market", tier: 1 },
      stored: store({ fingerprint: "accelerating:YES", seenCount: 1 }),
      nowMs: T0 + PERSIST,
    });
    expect(d.emit).toBe(false);
    expect(d.reason).toBe("new-episode");
    expect(d.state?.fingerprint).toBe("market_dividing:market");
    expect(d.state?.seenCount).toBe(1);
    expect(d.state?.firstSeenAt).toBe(T0 + PERSIST);
  });
});

describe("tier gate", () => {
  it("never emits a Tier-3 transition but still tracks it", () => {
    const d = decideTransitionEmit({
      current: { fingerprint: "losing_conviction:NO", tier: 3 },
      stored: store({ fingerprint: "losing_conviction:NO", seenCount: 3 }),
      nowMs: T0 + PERSIST * 5,
    });
    expect(d.emit).toBe(false);
    expect(d.reason).toBe("tier-too-low");
    expect(d.state?.seenCount).toBe(4);
  });
});

describe("anti-restatement", () => {
  it("stays silent about the same fingerprint within the cooldown", () => {
    const d = decideTransitionEmit({
      current: { fingerprint: "accelerating:YES", tier: 2 },
      stored: store({ seenCount: 5, lastEmittedAt: T0, firstSeenAt: T0 - PERSIST }),
      nowMs: T0 + TRANSITION_EMIT.restateCooldownMs - 1,
    });
    expect(d.emit).toBe(false);
    expect(d.reason).toBe("restate-cooldown");
  });

  it("re-emits a long-persisting state after the cooldown elapses", () => {
    const d = decideTransitionEmit({
      current: { fingerprint: "accelerating:YES", tier: 2 },
      stored: store({ seenCount: 50, lastEmittedAt: T0, firstSeenAt: T0 - PERSIST }),
      nowMs: T0 + TRANSITION_EMIT.restateCooldownMs,
    });
    expect(d.emit).toBe(true);
    expect(d.reason).toBe("emit");
  });
});

describe("clearing", () => {
  it("forgets the episode when nothing is current", () => {
    const d = decideTransitionEmit({
      current: null,
      stored: store({ seenCount: 9, lastEmittedAt: T0 }),
      nowMs: T0 + 1,
    });
    expect(d.emit).toBe(false);
    expect(d.reason).toBe("cleared");
    expect(d.state).toBeNull();
  });
});

describe("a full lifecycle", () => {
  it("silent → emit once → silent (restatement) → re-emit after cooldown", () => {
    let state: TransitionStore | null = null;
    const fire = (now: number) => {
      const d = decideTransitionEmit({
        current: { fingerprint: "market_dividing:market", tier: 1 },
        stored: state,
        nowMs: now,
      });
      state = d.state;
      return d.emit;
    };
    expect(fire(T0)).toBe(false); // first sight
    expect(fire(T0 + PERSIST)).toBe(true); // persisted → emit
    expect(fire(T0 + PERSIST + 60_000)).toBe(false); // restatement window
    expect(fire(T0 + PERSIST + TRANSITION_EMIT.restateCooldownMs + 60_000)).toBe(true); // cooldown over
  });
});
