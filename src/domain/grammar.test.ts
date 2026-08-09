import { describe, expect, it } from "vitest";
import { countNoun, fixAgreement, fixStoryAgreement } from "./grammar";

describe("fixAgreement", () => {
  it("singularises a countable noun after one", () => {
    expect(fixAgreement("One people took YES")).toBe("One person took YES");
    expect(fixAgreement("1 believers left")).toBe("1 believer left");
    expect(fixAgreement("Only 1 others are with them.")).toBe("Only 1 other is with them.");
  });

  it("pluralises a countable noun after a larger count", () => {
    expect(fixAgreement("2 person is out")).toBe("2 people are out");
    expect(fixAgreement("Held 3 day")).toBe("Held 3 days");
  });

  it("keeps adjectives between the count and the noun", () => {
    expect(fixAgreement("1 new believers arrived")).toBe("1 new believer arrived");
    expect(fixAgreement("+4 new believer today")).toBe("+4 new believers today");
  });

  it("leaves correct copy untouched", () => {
    const ok = "Two people piled into YES with $420.";
    expect(fixAgreement(ok)).toBe(ok);
    expect(fixAgreement("$1 moved")).toBe("$1 moved");
    expect(fixAgreement("1.5 hours ago")).toBe("1.5 hours ago");
  });

  it("does not touch nouns it does not count", () => {
    expect(fixAgreement("1 airdrop questions")).toBe("1 airdrop question");
    expect(fixAgreement("backed 3 markets at once")).toBe("backed 3 markets at once");
    expect(fixAgreement("1 tacos")).toBe("1 tacos");
  });

  it("fixes indefinite subjects that took a plural verb", () => {
    expect(fixAgreement("Nobody are on NO.")).toBe("Nobody is on NO.");
  });

  it("covers every prose field of a story", () => {
    const s = fixStoryAgreement({
      headline: "1 people stepped in",
      body: "1 believers backed YES.",
      attribution: "1 others are with them.",
      question: null,
    });
    expect(s.headline).toBe("1 person stepped in");
    expect(s.body).toBe("1 believer backed YES.");
    expect(s.attribution).toBe("1 other is with them.");
    expect(s.question).toBeNull();
  });
});

describe("countNoun", () => {
  it("inflects", () => {
    expect(countNoun(1, "believer")).toBe("1 believer");
    expect(countNoun(4, "believer")).toBe("4 believers");
    expect(countNoun(2, "person", "people")).toBe("2 people");
  });
});
