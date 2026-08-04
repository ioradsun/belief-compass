import { describe, it, expect } from "vitest";
import {
  enrichPeople,
  relationshipBoost,
  orderForViewer,
  describeCohort,
  relationshipClause,
  MAX_RELATIONSHIP_BOOST,
  type RelationshipMap,
} from "./viewer-relationship";
import { faceSplit, type CohortHolder } from "./conviction-cohort";
import type { NetworkLabel } from "./story";

const p = (wallet: string, o: Partial<CohortHolder> = {}): CohortHolder => ({
  wallet,
  name: wallet,
  avatarUrl: null,
  daysHeld: 30,
  positionUsd: 100,
  relationship: null,
  ...o,
});

const map = (pairs: Array<[string, NetworkLabel]>): RelationshipMap => new Map(pairs);

describe("the shared event stays viewer-independent", () => {
  it("enrichment never mutates the stored people", () => {
    const people = [p("0xa"), p("0xb")];
    const before = JSON.stringify(people);
    enrichPeople(people, map([["0xa", "twin"]]));
    expect(JSON.stringify(people)).toBe(before);
  });

  it("returns the universal group untouched for an anonymous reader", () => {
    const people = [p("0xa"), p("0xb")];
    expect(enrichPeople(people, null)).toBe(people);
    expect(enrichPeople(people, map([]))).toBe(people);
  });

  it("two viewers see the same group, differently labelled", () => {
    const people = [p("0xa"), p("0xb")];
    const one = enrichPeople(people, map([["0xa", "twin"]]));
    const two = enrichPeople(people, map([["0xb", "tribe"]]));
    expect(one.map((x) => x.wallet)).toEqual(two.map((x) => x.wallet));
    expect(one[0].relationship).toBe("twin");
    expect(two[0].relationship).toBeNull();
  });

  it("matches wallets case-insensitively, as addresses arrive either way", () => {
    const out = enrichPeople([p("0xAbC")], map([["0xabc", "tribe"]]));
    expect(out[0].relationship).toBe("tribe");
  });
});

describe("personalization is bounded", () => {
  it("never adds more than the cap", () => {
    const out = relationshipBoost([p("a", { relationship: "twin" })]);
    expect(out).toBeLessThanOrEqual(MAX_RELATIONSHIP_BOOST);
  });

  it("five tribe members are not five times more relevant than one", () => {
    const one = relationshipBoost([p("a", { relationship: "tribe" })]);
    const five = relationshipBoost(
      Array.from({ length: 5 }, (_, i) => p(`w${i}`, { relationship: "tribe" })),
    );
    expect(five).toBe(one);
  });

  it("cannot lift a routine event over a major one", () => {
    // A Twin's ordinary buy (0.5) must stay below the biggest believer leaving (0.8).
    const routine = 0.5 + relationshipBoost([p("a", { relationship: "twin" })]);
    expect(routine).toBeLessThan(0.8);
  });

  it("is zero with no relationships at all", () => {
    expect(relationshipBoost([p("a"), p("b")])).toBe(0);
  });
});

describe("the stack leads with people you know", () => {
  it("puts the strongest relationship first", () => {
    const out = orderForViewer([
      p("a", { positionUsd: 9000 }),
      p("b", { relationship: "tribe" }),
      p("c", { relationship: "twin" }),
    ]);
    expect(out.map((x) => x.wallet)).toEqual(["c", "b", "a"]);
  });

  it("is deterministic for a viewer with no relationships", () => {
    const people = [p("c"), p("a"), p("b")];
    expect(orderForViewer(people).map((x) => x.wallet)).toEqual(
      orderForViewer([...people].reverse()).map((x) => x.wallet),
    );
  });

  it("changes which faces show, never who is in the group", () => {
    const people = Array.from({ length: 10 }, (_, i) => p(`w${i}`));
    const mine = orderForViewer(enrichPeople(people, map([["w9", "twin"]])));
    expect(mine).toHaveLength(people.length);
    // The overflow count is computed from the same array, so it stays right.
    expect(faceSplit(mine).overflow).toBe(faceSplit(people).overflow);
    expect(faceSplit(mine).faces[0].wallet).toBe("w9");
  });
});

describe("a relationship is never overstated", () => {
  it("two of fourteen is NOT 'your Tribe is holding'", () => {
    const people = [
      p("a", { relationship: "tribe" }),
      p("b", { relationship: "tribe" }),
      ...Array.from({ length: 12 }, (_, i) => p(`x${i}`)),
    ];
    const d = describeCohort(people);
    expect(d.personal).toBe(true);
    expect(d.whole).toBe(false);
    expect(d.knownCount).toBe(2);
    expect(relationshipClause(d)).toBe("2 people from your Tribe");
  });

  it("claims the whole group only when the whole group qualifies", () => {
    const d = describeCohort([
      p("a", { relationship: "tribe" }),
      p("b", { relationship: "tribe" }),
    ]);
    expect(d.whole).toBe(true);
    expect(relationshipClause(d)).toBe("your Tribe");
  });

  it("says nothing personal when there is nothing personal to say", () => {
    const d = describeCohort([p("a"), p("b")]);
    expect(d.personal).toBe(false);
    expect(relationshipClause(d)).toBeNull();
  });

  it("a rival is not 'your people'", () => {
    const d = describeCohort([
      p("a", { relationship: "opp" }),
      p("b", { relationship: "inverse" }),
    ]);
    expect(d.personal).toBe(false);
    expect(relationshipClause(d)).toBeNull();
  });

  it("names the strongest relationship present", () => {
    const d = describeCohort([p("a", { relationship: "tribe" }), p("b", { relationship: "twin" })]);
    expect(d.lead).toBe("twin");
    expect(relationshipClause(d)).toBe("your closest matches");
  });

  it("reads correctly for a single known person in a crowd", () => {
    const d = describeCohort([p("a", { relationship: "tribe" }), p("b"), p("c")]);
    expect(relationshipClause(d)).toBe("1 person from your Tribe");
  });
});

describe("anonymous readers are not a degraded case", () => {
  it("gets the universal group, in a stable order, with no empty personalization", () => {
    const people = [p("b"), p("a"), p("c")];
    const anon = enrichPeople(people, null);
    const d = describeCohort(anon);
    expect(d.personal).toBe(false);
    expect(relationshipClause(d)).toBeNull();
    expect(relationshipBoost(anon)).toBe(0);
    expect(orderForViewer(anon).map((x) => x.wallet)).toEqual(["a", "b", "c"]);
  });
});
