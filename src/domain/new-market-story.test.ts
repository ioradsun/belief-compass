import { describe, expect, it } from "vitest";
import { tellNewMarketStory } from "./new-market-story";

describe("a new market is not news by itself", () => {
  it("suppresses a bare question with no actor and no reaction", () => {
    const v = tellNewMarketStory({ ageHours: 1 });
    expect(v.suppress).toBe(true);
    expect(v.story).toBeNull();
    expect(v.level).toBe("receipt");
  });

  it("never invents an opener", () => {
    const v = tellNewMarketStory({ creatorName: null, believersYes: 2, ageHours: 1 });
    expect(v.story?.body ?? "").not.toMatch(/someone opened/i);
    expect(v.story?.headline).not.toMatch(/undefined|null/i);
  });

  it("keeps a named creator with nothing behind them out of the primary surface", () => {
    const v = tellNewMarketStory({ creatorName: "Hamid", ageHours: 1 });
    expect(v.level).toBe("receipt");
    expect(v.suppress).toBe(true);
  });

  it("lets a personally relevant creator through as an observation", () => {
    const v = tellNewMarketStory({ creatorName: "Jacek", creatorRelationship: "Rival", ageHours: 1 });
    expect(v.level).toBe("observation");
    expect(v.suppress).toBe(false);
    expect(v.story?.headline).toBe("JACEK PUT THIS ON THE TABLE");
  });
});

describe("reaction is what makes a new market a story", () => {
  it("names the opener and says who took a side", () => {
    const v = tellNewMarketStory({ creatorName: "Jacek", believersYes: 3, ageHours: 20 });
    expect(v.level).toBe("intelligence");
    expect(v.story?.headline).toBe("JACEK PUT THIS ON THE TABLE");
    expect(v.story?.body).toBe("Three people have already taken YES.");
  });

  it("asks the question only when the reaction is unusually fast", () => {
    const fast = tellNewMarketStory({ creatorName: "Jacek", believersYes: 3, ageHours: 1 });
    expect(fast.story?.question).toBe("Why did this one catch so quickly?");
    const slow = tellNewMarketStory({ creatorName: "Jacek", believersYes: 3, ageHours: 20 });
    expect(slow.story?.question ?? null).toBeNull();
  });

  it("leads with someone the reader knows when one is already in", () => {
    const v = tellNewMarketStory({
      creatorName: "Hamid",
      believersNo: 2,
      ageHours: 2,
      personal: { name: "Your Rival", relationship: "Rival", side: "NO" },
    });
    expect(v.story?.body).toBe("Your Rival was one of the first people into NO.");
    expect(v.story?.personal).toBe(true);
  });

  it("turns long silence into the clue", () => {
    const v = tellNewMarketStory({ creatorName: "Hamid", ageHours: 5 });
    expect(v.level).toBe("intelligence");
    expect(v.story?.headline).toBe("STILL WAITING FOR A SIDE");
    expect(v.story?.body).toContain("Nobody has backed it yet.");
  });

  it("stops calling an old empty market news", () => {
    expect(tellNewMarketStory({ creatorName: "Hamid", ageHours: 200 }).suppress).toBe(true);
  });
});
