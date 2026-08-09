import { describe, expect, it } from "vitest";
import {
  dominantKey,
  mergeSignals,
  signalFromTransition,
  transitionFreshness,
} from "./transition-signal";
import type { VoiceInput } from "./pi-voice";

const empty = (): VoiceInput => ({
  signals: {
    tension: 0,
    beforePrice: 0,
    unusual: 0,
    concentration: 0,
    reversing: 0,
    building: 0,
    nonresponse: 0,
    confirmation: 0,
  },
  informationGain: 0,
});

describe("a derived reading carries its own evidence", () => {
  it("recovers the contradiction the rolled windows lost", () => {
    const v = signalFromTransition({
      type: "people_capital_divergence",
      significance: 0.9,
      ageHours: 4,
    });
    expect(v?.signals.tension).toBeCloseTo(0.9);
    expect(v?.tensionKind).toBe("people_up_capital_down");
    expect(v?.informationGain).toBeGreaterThan(0.5);
  });

  it("decays with age and stops speaking once stale", () => {
    const fresh = signalFromTransition({ type: "accelerating", significance: 1, ageHours: 1 });
    const older = signalFromTransition({ type: "accelerating", significance: 1, ageHours: 18 });
    expect(older!.signals.unusual).toBeLessThan(fresh!.signals.unusual);
    expect(signalFromTransition({ type: "accelerating", significance: 1, ageHours: 40 })).toBeNull();
  });

  it("invents nothing for a shape it does not know", () => {
    expect(signalFromTransition({ type: "who_knows", significance: 1, ageHours: 1 })).toBeNull();
    expect(signalFromTransition({ type: null, ageHours: 1 })).toBeNull();
  });

  it("never exceeds the significance the emitter recorded", () => {
    const v = signalFromTransition({ type: "concentration_rising", significance: 0.3, ageHours: 0 });
    expect(v!.signals.concentration).toBeCloseTo(0.3);
  });

  it("lets live state win where it still sees more", () => {
    const live = empty();
    live.signals.tension = 0.8;
    live.informationGain = 0.6;
    const merged = mergeSignals(live, signalFromTransition({
      type: "people_capital_divergence",
      significance: 0.4,
      ageHours: 1,
    }));
    expect(merged.signals.tension).toBeCloseTo(0.8);
    expect(merged.informationGain).toBeCloseTo(0.6);
  });

  it("fills the silence the live state left behind", () => {
    const merged = mergeSignals(empty(), signalFromTransition({
      type: "people_capital_divergence",
      significance: 0.7,
      ageHours: 1,
    }));
    expect(merged.signals.tension).toBeCloseTo(0.7);
    expect(merged.tensionKind).toBe("people_up_capital_down");
  });

  it("keeps freshness inside 0..1", () => {
    expect(transitionFreshness(0)).toBe(1);
    expect(transitionFreshness(-1)).toBe(0);
    expect(transitionFreshness(1000)).toBe(0);
  });

  it("names the loudest shape", () => {
    const v = empty();
    v.signals.building = 0.9;
    v.signals.tension = 0.5;
    expect(dominantKey(v)).toBe("tension");
    expect(dominantKey(empty())).toBe("none");
  });
});
