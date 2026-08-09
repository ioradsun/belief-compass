import { describe, expect, it } from "vitest";
import { classifyFirstEvent, type FirstEventInput } from "./first-event";

const base: FirstEventInput = {
  believersBefore: 0,
  believersAfter: 1,
  peopleCount: 1,
  capitalBeforeUsd: 0,
  capitalAfterUsd: 5,
};

describe("first-event taxonomy is mutually exclusive", () => {
  it("one person into an empty side went first", () => {
    expect(classifyFirstEvent(base)).toBe("went_first");
  });

  it("several people into an empty side opened the side — nobody 'went first'", () => {
    expect(classifyFirstEvent({ ...base, believersAfter: 2, peopleCount: 2 })).toBe("side_opened");
  });

  it("first money on an already-populated side is first_capital", () => {
    expect(
      classifyFirstEvent({
        believersBefore: 3,
        believersAfter: 3,
        peopleCount: 1,
        capitalBeforeUsd: 0,
        capitalAfterUsd: 12,
      }),
    ).toBe("first_capital");
  });

  it("never calls an empty-side arrival first_capital, even though money also arrived", () => {
    expect(classifyFirstEvent({ ...base, capitalBeforeUsd: 0, capitalAfterUsd: 99 })).toBe(
      "went_first",
    );
  });

  it("says nothing about an ordinary join", () => {
    expect(
      classifyFirstEvent({
        believersBefore: 4,
        believersAfter: 5,
        peopleCount: 1,
        capitalBeforeUsd: 20,
        capitalAfterUsd: 25,
      }),
    ).toBeNull();
  });

  it("dust is not capital arriving", () => {
    expect(
      classifyFirstEvent({
        believersBefore: 2,
        believersAfter: 2,
        capitalBeforeUsd: 0,
        capitalAfterUsd: 0.001,
      }),
    ).toBeNull();
  });
});
