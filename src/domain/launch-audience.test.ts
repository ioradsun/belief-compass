import { describe, it, expect } from "vitest";
import {
  composeAudience,
  reasonForMember,
  launchLadder,
  AUDIENCE,
  AUDIENCE_ORDER,
  CONVERSATION_SIZE,
  type AudienceCandidate,
  type AudienceEvidence,
} from "./launch-audience";

const cand = (
  wallet: string,
  evidence: AudienceEvidence,
  name: string | null = null,
): AudienceCandidate => ({ wallet, name, evidence });

const adjacent = (over: Partial<Extract<AudienceEvidence, { kind: "adjacent" }>> = {}) =>
  ({
    kind: "adjacent",
    similarTitle: "Will France win the World Cup?",
    similarCount: 1,
    ...over,
  }) satisfies AudienceEvidence;

const tribe = (over: Partial<Extract<AudienceEvidence, { kind: "tribe" }>> = {}) =>
  ({ kind: "tribe", agreement: 87, shared: 12, topic: null, ...over }) satisfies AudienceEvidence;

const rival = (over: Partial<Extract<AudienceEvidence, { kind: "rival" }>> = {}) =>
  ({ kind: "rival", agreement: 20, shared: 9, ...over }) satisfies AudienceEvidence;

const category = (over: Partial<Extract<AudienceEvidence, { kind: "category" }>> = {}) =>
  ({ kind: "category", label: "Money", backed: 4, ...over }) satisfies AudienceEvidence;

/**
 * THE SAME RULE AS THE SHELF, FROM THE OTHER END. `for-you` refuses to SHOW a
 * row it cannot justify; this refuses to OFFER a person it cannot justify. The
 * sentence is composed once and stored on the invitation, so a person with no
 * sentence is not a weaker suggestion — they are one we have no business making.
 */
describe("nobody is offered without a sentence that justifies them", () => {
  it("gives every offered person a non-empty reason", () => {
    const rows = composeAudience([
      cand("0xa", adjacent()),
      cand("0xb", tribe()),
      cand("0xc", rival()),
      cand("0xd", category()),
      cand("0xe", { kind: "follower" }),
    ]);
    const people = rows.flatMap((r) => r.people);
    expect(people).toHaveLength(5);
    for (const p of people) expect(p.reason.trim().length).toBeGreaterThan(0);
  });

  it("refuses agreement without enough shared history to call it a pattern", () => {
    expect(reasonForMember(tribe({ shared: AUDIENCE.minSharedForAgreement - 1 }))).toBeNull();
    expect(reasonForMember(tribe({ shared: null }))).toBeNull();
    expect(reasonForMember(tribe({ agreement: null }))).toBeNull();
    expect(reasonForMember(rival({ shared: AUDIENCE.minSharedForAgreement - 1 }))).toBeNull();
  });

  it("refuses a Tribe claim about someone who does not actually agree", () => {
    expect(reasonForMember(tribe({ agreement: AUDIENCE.tribeAgreement - 1 }))).toBeNull();
    expect(reasonForMember(rival({ agreement: AUDIENCE.rivalAgreement + 1 }))).toBeNull();
  });

  it("refuses a category claim from a single market", () => {
    expect(reasonForMember(category({ backed: AUDIENCE.minCategoryBacked - 1 }))).toBeNull();
    expect(reasonForMember(category({ label: "  " }))).toBeNull();
  });

  it("refuses an adjacent claim with no market to point at", () => {
    expect(reasonForMember(adjacent({ similarTitle: "" }))).toBeNull();
    expect(reasonForMember(adjacent({ similarCount: 0 }))).toBeNull();
  });

  it("accepts a follower on the strength of the follow alone", () => {
    // The one relationship that is a deliberate statement rather than an
    // inference — this person asked to hear from the creator.
    expect(reasonForMember({ kind: "follower" })).toBe("Follows you");
  });

  it("drops the unjustifiable rather than offering them quietly", () => {
    const rows = composeAudience([
      cand("0xa", tribe({ shared: 1 })),
      cand("0xb", category({ backed: 0 })),
      cand("0xc", adjacent({ similarTitle: "   " })),
    ]);
    expect(rows.flatMap((r) => r.people)).toEqual([]);
  });
});

describe("the sentences say something a person would recognise", () => {
  it("names the market for a single adjacent holder", () => {
    expect(reasonForMember(adjacent())).toBe('Backed "Will France win the World Cup?"');
  });

  it("counts and still names one for several", () => {
    expect(reasonForMember(adjacent({ similarCount: 3 }))).toBe(
      'Backed 3 similar markets, including "Will France win the World Cup?"',
    );
  });

  it("shortens a long question instead of swallowing the sentence", () => {
    const long = "x".repeat(200);
    const r = reasonForMember(adjacent({ similarTitle: long }))!;
    expect(r).toContain("…");
    expect(r.length).toBeLessThan(100);
  });

  it("states agreement as agreement and disagreement as disagreement", () => {
    expect(reasonForMember(tribe({ agreement: 87, shared: 12 }))).toBe(
      "You agree 87% of the time across 12 markets",
    );
    expect(reasonForMember(rival({ agreement: 20, shared: 9 }))).toBe(
      "You disagree 80% of the time across 9 markets",
    );
  });

  it("sharpens with a topic when one dominates", () => {
    expect(reasonForMember(tribe({ topic: "AI" }))).toContain("most of all on AI");
  });
});

describe("all five rows, always, each empty for its own stated reason", () => {
  it("renders every row even when the whole panel is empty", () => {
    const rows = composeAudience([]);
    expect(rows.map((r) => r.kind)).toEqual([...AUDIENCE_ORDER]);
    for (const r of rows) {
      expect(r.people).toEqual([]);
      expect(r.emptyState.trim().length).toBeGreaterThan(0);
    }
  });

  it("gives each row a DIFFERENT empty state, since each is empty differently", () => {
    // Measured: Adjacent is thin, Tribe needs history, Rivals is zero for
    // everyone, Followers has no edges at all. One generic line would erase the
    // only useful thing an empty row can tell a creator.
    const empties = composeAudience([]).map((r) => r.emptyState);
    expect(new Set(empties).size).toBe(empties.length);
    for (const e of empties) expect(e).not.toMatch(/^0\b/);
  });

  it("leads with Adjacent, the only audience with density today", () => {
    expect(composeAudience([])[0].kind).toBe("adjacent");
  });
});

describe("one face, one row", () => {
  it("keeps a person under their strongest claim and nowhere else", () => {
    const rows = composeAudience([
      cand("0xa", category()),
      cand("0xa", tribe()),
      cand("0xa", adjacent()),
    ]);
    const found = rows.filter((r) => r.people.some((p) => p.wallet === "0xa"));
    expect(found).toHaveLength(1);
    expect(found[0].kind).toBe("adjacent");
  });

  it("never offers the creator their own market", () => {
    const rows = composeAudience([cand("0xME", adjacent())], { creator: "0xme" });
    expect(rows.flatMap((r) => r.people)).toEqual([]);
  });

  it("never offers someone already holding a position here", () => {
    const rows = composeAudience([cand("0xa", adjacent()), cand("0xb", tribe())], {
      alreadyIn: new Set(["0xa"]),
    });
    expect(rows.flatMap((r) => r.people).map((p) => p.wallet)).toEqual(["0xb"]);
  });

  it("lowercases wallets, so a checksummed address cannot slip the dedup", () => {
    const rows = composeAudience([cand("0xAB", adjacent()), cand("0xab", tribe())]);
    expect(rows.flatMap((r) => r.people)).toHaveLength(1);
  });

  it("bounds each row, so recruitment stays a choice rather than a mailing list", () => {
    const many = Array.from({ length: 40 }, (_, i) => cand(`0x${i}`, adjacent()));
    expect(composeAudience(many)[0].people.length).toBe(AUDIENCE.perRow);
  });

  it("carries the already-invited flag through, so the button can say so", () => {
    const rows = composeAudience([{ ...cand("0xa", adjacent()), invited: true }]);
    expect(rows[0].people[0].invited).toBe(true);
  });
});

/**
 * LAUNCH PROGRESS MEASURES OUTCOMES, NOT EFFORT. Invitations sent is how hard
 * the creator worked; a panel that celebrates it congratulates someone for
 * pressing a button.
 */
describe("the ladder is what happened to the debate", () => {
  const p = (over: Partial<Parameters<typeof launchLadder>[0]> = {}) =>
    launchLadder({ invited: 0, viewed: 0, joined: 0, backed: 0, participants: 0, ...over });

  it("never presents invitations sent as a rung", () => {
    expect(p().map((s) => s.label)).toEqual(["Viewed", "Joined", "Backed", "Reached 5"]);
  });

  it("uses invitations only as the denominator", () => {
    const [viewed] = p({ invited: 10, viewed: 3 });
    expect(viewed.of).toBe(10);
    expect(viewed.detail).toContain("3 of 10");
  });

  it("says so plainly when nothing has happened, on every rung", () => {
    for (const step of p()) {
      expect(step.reached).toBe(false);
      expect(step.detail.trim().length).toBeGreaterThan(0);
      expect(step.detail).not.toMatch(/^0\b/);
    }
  });

  it("keeps joined and backed apart, because one costs money and one does not", () => {
    const steps = p({ invited: 5, viewed: 4, joined: 3, backed: 1 });
    expect(steps[1].value).toBe(3);
    expect(steps[2].value).toBe(1);
    expect(steps[2].of).toBe(3);
  });

  it("marks the conversation threshold only when the room actually reaches it", () => {
    expect(p({ participants: CONVERSATION_SIZE - 1 })[3].reached).toBe(false);
    expect(p({ participants: CONVERSATION_SIZE })[3].reached).toBe(true);
  });

  it("tells a creator short of the threshold that almost nobody gets there", () => {
    // True: 2.3% of markets reach five participants. Saying it turns a number
    // that reads as failure into one that reads as context.
    expect(p({ participants: 2 })[3].detail).toContain("Most markets never get here");
  });
});
