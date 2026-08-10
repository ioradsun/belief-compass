import { describe, it, expect } from "vitest";
import {
  FACES_PER_GROUP,
  audienceGroupFor,
  dedupeAudience,
  groupAudience,
  presentAudience,
  singleRecipientName,
  type AudienceMember,
  type AudienceProvenance,
  type CallRelationAtTime,
} from "./audience";

const m = (
  wallet: string,
  relationAtCall: CallRelationAtTime,
  provenance: AudienceProvenance = "strong_dna",
  over: Partial<AudienceMember> = {},
): AudienceMember => ({
  wallet,
  relationAtCall,
  group: audienceGroupFor(relationAtCall),
  provenance,
  sharedBeliefs: null,
  sameSideBeliefs: null,
  displayName: wallet,
  avatarUrl: null,
  ...over,
});

describe("a relationship is truth; a group is a heading", () => {
  it("maps the strong relationships to their two sides", () => {
    expect(audienceGroupFor("twin")).toBe("tribe");
    expect(audienceGroupFor("tribe")).toBe("tribe");
    expect(audienceGroupFor("opp")).toBe("rivals");
    expect(audienceGroupFor("inverse")).toBe("rivals");
  });

  it("maps both weak relationships to Still Forming", () => {
    expect(audienceGroupFor("neutral")).toBe("forming");
    expect(audienceGroupFor("insufficient")).toBe("forming");
  });

  it("has no relationship called 'forming'", () => {
    // Storing the heading would make presentation copy permanent, and the day it
    // was renamed every historical row would misdescribe what the engine knew.
    const relations: CallRelationAtTime[] = [
      "twin",
      "tribe",
      "neutral",
      "opp",
      "inverse",
      "insufficient",
    ];
    expect(relations).not.toContain("forming");
    // @ts-expect-error "forming" is a group, never a relationship
    expect(() => audienceGroupFor("forming")).toThrow();
  });
});

describe("one wallet appears once, keeping the strongest canonical fact", () => {
  it("lets strong DNA outrank neutral, and neutral outrank closest", () => {
    const out = dedupeAudience([
      m("0xa", "insufficient", "closest_match"),
      m("0xa", "neutral", "neutral_dna"),
      m("0xa", "tribe", "strong_dna"),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].relationAtCall).toBe("tribe");
  });

  it("lets a closest match outrank history alone", () => {
    // A shared directional belief says more about two people than the fact that
    // one of them once answered the other.
    const out = dedupeAudience([
      m("0xa", "insufficient", "answered_challenge"),
      m("0xa", "insufficient", "closest_match"),
    ]);
    expect(out[0].provenance).toBe("closest_match");
  });

  it("does not depend on the order the sources were read", () => {
    const rows = [
      m("0xa", "neutral", "neutral_dna"),
      m("0xa", "twin", "strong_dna"),
      m("0xa", "insufficient", "answered_challenge"),
    ];
    const forward = dedupeAudience(rows);
    const back = dedupeAudience([...rows].reverse());
    expect(forward).toEqual(back);
  });

  it("treats a case-varying wallet as one person", () => {
    const out = dedupeAudience([m("0xAB", "tribe"), m("0xab", "neutral", "neutral_dna")]);
    expect(out).toHaveLength(1);
    expect(out[0].wallet).toBe("0xab");
  });
});

describe("the groups a reader actually sees", () => {
  it("omits every empty group", () => {
    const groups = groupAudience([m("0xa", "neutral", "neutral_dna")]);
    expect(groups.map((g) => g.key)).toEqual(["forming"]);
  });

  it("names a Twin rather than folding them into a plural", () => {
    expect(groupAudience([m("0xa", "twin")])[0].label).toBe("Your Twin");
    expect(groupAudience([m("0xa", "twin"), m("0xb", "tribe")])[0].label).toBe("Your Twin + Tribe");
    expect(groupAudience([m("0xb", "tribe")])[0].label).toBe("Your Tribe");
  });

  it("keeps group totals equal to the audience", () => {
    const people = [
      m("0xa", "twin"),
      m("0xb", "tribe"),
      m("0xc", "opp"),
      m("0xd", "neutral", "neutral_dna"),
      m("0xe", "insufficient", "closest_match"),
    ];
    const groups = groupAudience(people);
    expect(groups.reduce((n, g) => n + g.count, 0)).toBe(people.length);
  });

  it("shows a bounded number of faces and counts the rest", () => {
    const many = Array.from({ length: 9 }, (_, i) => m(`0x${i}`, "tribe"));
    const [g] = groupAudience(many);
    expect(g.visiblePeople).toHaveLength(FACES_PER_GROUP);
    expect(g.overflow).toBe(9 - FACES_PER_GROUP);
  });

  it("never promises a relationship transition it cannot compute", () => {
    // The canonical model exposes no boundary distance, so "two answers away
    // from your Tribe" is a counterfactual nothing can prove.
    for (const g of groupAudience([m("0xa", "neutral", "neutral_dna"), m("0xb", "tribe")]))
      expect(g.note.toLowerCase()).not.toMatch(/away from|close to your|become a/);
  });
});

describe("the one name a CTA may use", () => {
  it("returns the sole recipient's actual name", () => {
    expect(singleRecipientName([m("0xa", "tribe", "strong_dna", { displayName: "Maya" })])).toBe(
      "Maya",
    );
  });

  it("returns nothing for a crowd, so no button can name one of many", () => {
    expect(singleRecipientName([m("0xa", "tribe"), m("0xb", "tribe")])).toBeNull();
  });

  it("returns nothing rather than an untrustworthy name", () => {
    expect(
      singleRecipientName([m("0xa", "tribe", "strong_dna", { displayName: "   " })]),
    ).toBeNull();
  });
});

describe("the assembled payload", () => {
  it("reports none rather than an empty available audience", () => {
    expect(presentAudience([])).toEqual({ status: "none" });
  });

  it("dedupes before it counts, so the total is people not rows", () => {
    const r = presentAudience([m("0xa", "tribe"), m("0xa", "neutral", "neutral_dna")]);
    expect(r.status).toBe("available");
    if (r.status !== "available") return;
    expect(r.total).toBe(1);
    expect(r.groups.reduce((n, g) => n + g.count, 0)).toBe(1);
  });

  it("carries the single name onto the payload the CTA reads", () => {
    const r = presentAudience([m("0xa", "opp", "strong_dna", { displayName: "Casey" })]);
    if (r.status !== "available") throw new Error("expected available");
    expect(r.singleRecipientName).toBe("Casey");
  });
});
