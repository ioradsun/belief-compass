import { describe, it, expect } from "vitest";
import {
  findDiscoveryMoments,
  tellDiscoveryMoment,
  DISCOVERY_MOMENT,
  type MomentRelationship,
  type ViewerNetwork,
} from "./discovery-moment";
import { scoreDiscoveryMoment, bandOf, scoreMarketTransition } from "./significance";

const NOW = Date.UTC(2026, 7, 4, 12);
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const DAY = 86_400_000;

let n = 0;
const rel = (o: Partial<MomentRelationship> = {}): MomentRelationship => {
  n += 1;
  return {
    wallet: `0x${n}`,
    name: `P${n}`,
    relationship: "tribe",
    agreement: 80,
    sharedBeliefs: 20,
    topicCount: 3,
    confidence: 0.7,
    ...o,
  };
};

const net = (o: Partial<ViewerNetwork> = {}): ViewerNetwork => ({
  twin: [],
  tribe: [],
  opp: [],
  inverse: [],
  ...o,
});

const find = (v: ViewerNetwork) => findDiscoveryMoments(v, { nowMs: NOW });

describe("a moment is a label that just changed", () => {
  it("finds a Twin who became one inside the window", () => {
    const m = find(net({ twin: [rel({ relationship: "twin", since: ago(DAY) })] }));
    expect(m.map((x) => x.kind)).toEqual(["new_twin"]);
  });

  it("says nothing about a Twin you have had for a year", () => {
    expect(find(net({ twin: [rel({ relationship: "twin", since: ago(365 * DAY) })] }))).toEqual([]);
  });

  it("says nothing when we do not know when the relationship formed", () => {
    // Caches written before `since` existed. We must not announce a Twin the
    // reader has had all along just because we started recording today.
    expect(find(net({ twin: [rel({ relationship: "twin", since: null })] }))).toEqual([]);
  });

  it("never announces a thinly evidenced label", () => {
    expect(
      find(
        net({
          twin: [rel({ relationship: "twin", since: ago(DAY), sharedBeliefs: 3 })],
        }),
      ),
    ).toEqual([]);
    expect(DISCOVERY_MOMENT.minShared).toBeGreaterThan(3);
  });

  it("ignores a timestamp in the future", () => {
    const future = new Date(NOW + DAY).toISOString();
    expect(find(net({ twin: [rel({ relationship: "twin", since: future })] }))).toEqual([]);
  });
});

describe("Opp is a discovery, not an accusation", () => {
  it("finds a new Opp — the strongest opposite, stored as `inverse`", () => {
    const m = find(net({ inverse: [rel({ relationship: "inverse", since: ago(DAY) })] }));
    expect(m.map((x) => x.kind)).toEqual(["new_opp"]);
  });

  it("reads as a change of Opp when the record shows someone was displaced", () => {
    const m = find(
      net({
        inverse: [rel({ relationship: "inverse", since: ago(DAY) })],
        opp: [rel({ relationship: "opp", previous: "inverse" })],
      }),
    );
    expect(m[0].kind).toBe("opp_changed");
    // Only the person you can go and read is shown.
    expect(m[0].people).toHaveLength(1);
  });

  it("never frames them as an enemy", () => {
    const m = find(net({ inverse: [rel({ relationship: "inverse", since: ago(DAY) })] }));
    const s = tellDiscoveryMoment(m[0]);
    expect(`${s.headline} ${s.body}`).not.toMatch(/enemy|against you|beat|wrong|attack|threat/i);
    expect(s.body).toMatch(/challenge/i);
  });
});

describe("the group outranks the individual", () => {
  it("three people crossing into your Tribe is one story", () => {
    const m = find(
      net({
        tribe: [
          rel({ since: ago(DAY) }),
          rel({ since: ago(2 * DAY) }),
          rel({ since: ago(DAY / 2) }),
        ],
      }),
    );
    expect(m).toHaveLength(1);
    expect(m[0].people).toHaveLength(3);
  });

  it("the same arrivals always tell the same story, in any order", () => {
    const rows = [rel({ since: ago(DAY) }), rel({ since: ago(2 * DAY) })];
    const a = find(net({ tribe: rows }))[0].id;
    const b = find(net({ tribe: [...rows].reverse() }))[0].id;
    expect(a).toBe(b);
  });
});

describe("threshold crossings only", () => {
  it("reports the Tribe passing a rung", () => {
    const older = Array.from({ length: 23 }, () => rel({ since: ago(90 * DAY) }));
    const fresh = [rel({ since: ago(DAY) }), rel({ since: ago(DAY) })];
    const m = find(net({ tribe: [...older, ...fresh] }));
    expect(m[0].kind).toBe("tribe_grew");
    expect(m[0].rung).toBe(25);
    expect(tellDiscoveryMoment(m[0]).body).toMatch(/past 25/);
  });

  it("does not re-announce a rung crossed long ago", () => {
    // 30 members, one new — 25 was passed weeks back.
    const older = Array.from({ length: 29 }, () => rel({ since: ago(90 * DAY) }));
    const m = find(net({ tribe: [...older, rel({ since: ago(DAY) })] }));
    expect(m[0].kind).toBe("new_tribe_member");
  });

  it("growth between rungs is simply an arrival, not a milestone", () => {
    const older = Array.from({ length: 11 }, () => rel({ since: ago(90 * DAY) }));
    const m = find(net({ tribe: [...older, rel({ since: ago(DAY) })] }));
    expect(m[0].kind).toBe("new_tribe_member");
  });
});

describe("rarity is the product", () => {
  it("never floods a feed, however much changed at once", () => {
    const m = find(
      net({
        twin: [rel({ relationship: "twin", since: ago(DAY) })],
        inverse: [rel({ relationship: "inverse", since: ago(DAY) })],
        tribe: [rel({ since: ago(DAY) }), rel({ since: ago(DAY) })],
      }),
    );
    expect(m.length).toBeLessThanOrEqual(DISCOVERY_MOMENT.maxPerFeed);
  });

  it("keeps the rarest when it has to choose", () => {
    const m = find(
      net({
        twin: [rel({ relationship: "twin", since: ago(DAY) })],
        inverse: [rel({ relationship: "inverse", since: ago(DAY) })],
        tribe: [rel({ since: ago(DAY) }), rel({ since: ago(DAY) })],
      }),
    );
    expect(m.map((x) => x.kind)).toEqual(["new_twin", "new_opp"]);
  });

  it("one Twin, even if two arrive at once", () => {
    const m = find(
      net({
        twin: [
          rel({ relationship: "twin", since: ago(DAY) }),
          rel({ relationship: "twin", since: ago(2 * DAY) }),
        ],
      }),
    );
    expect(m.filter((x) => x.kind === "new_twin")).toHaveLength(1);
  });

  it("is deterministic — the same network always yields the same rows", () => {
    const v = net({
      twin: [rel({ relationship: "twin", since: ago(DAY) })],
      tribe: [rel({ since: ago(DAY) }), rel({ since: ago(3 * DAY) })],
    });
    expect(find(v).map((x) => x.id)).toEqual(find(v).map((x) => x.id));
  });

  it("a quiet network produces nothing at all", () => {
    expect(find(net({ tribe: [rel({ since: ago(200 * DAY) })] }))).toEqual([]);
  });
});

describe("where a moment sits on the shared significance scale", () => {
  const sig = (rarity: number, shared = 30) =>
    scoreDiscoveryMoment({ rarity, sharedConvictions: shared }).score;

  it("meeting your Twin is as important as a market changing its answer", () => {
    const flip = scoreMarketTransition({ type: "majority_flipped", tier: 1, share: 0.6 }).score;
    expect(bandOf(sig(1))).toBe("exceptional");
    expect(Math.abs(sig(1) - flip)).toBeLessThan(0.1);
  });

  it("finding your Opp reaches the same band as finding your Twin", () => {
    expect(bandOf(sig(0.95))).toBe("exceptional");
  });

  it("an ordinary new Tribe member does not skip the queue", () => {
    // Below the mixer's breaking threshold — it competes, it does not interrupt.
    expect(sig(0.5, 10)).toBeLessThan(0.8);
  });

  it("thin evidence lowers even the rarest moment", () => {
    expect(sig(1, 8)).toBeLessThan(sig(1, 40));
  });
});

describe("copy: state the evidence, then stop", () => {
  it("a new Twin gives the reader a reason to click, not an explanation", () => {
    const m = find(
      net({ twin: [rel({ relationship: "twin", since: ago(DAY), sharedBeliefs: 41 })] }),
    );
    const s = tellDiscoveryMoment(m[0]);
    expect(s.headline).toBe("NEW TWIN");
    expect(s.body).toMatch(/same side 41 times/);
    // No mechanism, no percentages, no justification of the label.
    expect(s.body).not.toMatch(/%|algorithm|score|match|because/i);
    expect(s.personal).toBe(true);
  });

  it("names up to two people, then counts the rest", () => {
    const m = find(
      net({
        tribe: [
          rel({ name: "Jon", since: ago(DAY) }),
          rel({ name: "Kate", since: ago(DAY) }),
          rel({ name: "Ada", since: ago(DAY) }),
          rel({ name: "Sam", since: ago(DAY) }),
        ],
      }),
    );
    expect(tellDiscoveryMoment(m[0]).body).toMatch(/, and 2 others/);
  });

  it("never leaks a hex address when someone has no name", () => {
    const m = find(net({ twin: [rel({ relationship: "twin", name: null, since: ago(DAY) })] }));
    expect(tellDiscoveryMoment(m[0]).body).not.toMatch(/0x/);
  });

  it("headline and body never blame, shame, or pressure", () => {
    const all = [
      net({ twin: [rel({ relationship: "twin", since: ago(DAY) })] }),
      net({ inverse: [rel({ relationship: "inverse", since: ago(DAY) })] }),
      net({ tribe: [rel({ since: ago(DAY) }), rel({ since: ago(DAY) })] }),
    ].flatMap((v) => find(v).map(tellDiscoveryMoment));
    for (const s of all)
      expect(`${s.headline} ${s.body}`).not.toMatch(
        /should|must|don't leave|betray|abandon|loyal|quit/i,
      );
  });
});
