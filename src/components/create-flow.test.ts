import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const code = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

/**
 * THE RAILS CHANGE JOBS AS THE STORY MOVES, and that transition is the feature.
 *
 *   WRITING   left: already out there?  centre: what do you believe?  right: a spark
 *   PUBLISHED left: discovery           centre: your market is live   right: your people
 *
 * Recruitment belongs strictly after publish. Asking "who should show up?" before
 * the question exists is premature, and putting it in the form makes the form a
 * CMS instead of a conviction.
 */
describe("the create surface tells one story, and the rails follow it", () => {
  it("shows a spark in the right rail while writing, not a recruiting desk", () => {
    const route = code("src/routes/index.tsx");
    expect(route).toMatch(/createOpen \|\| ideaDue \? \(\s*<IdeasRail/);
  });

  it("keeps Challenge out of the composer entirely", () => {
    // ChallengeRail must be the ELSE branch of createOpen — a Challenge card
    // beside a half-written question is answering a question nobody asked yet.
    const route = code("src/routes/index.tsx");
    const ideas = route.indexOf("<IdeasRail");
    const challenge = route.indexOf("<ChallengeRail", ideas);
    expect(ideas).toBeGreaterThan(-1);
    expect(challenge).toBeGreaterThan(ideas);
  });

  it("puts 'your people' after publish and nowhere else", () => {
    // LaunchRail already owned this; the assertion pins it so recruitment cannot
    // drift back into the form.
    // Reach now lives in the Challenge column, where a free slot is an
    // invitation with a market attached. The form still never recruits.
    expect(code("src/components/CreateMarket.tsx")).not.toMatch(/callReach|Tribe|Rival/);
  });
});

describe("the idea rail never costs the writer a sentence", () => {
  it("only offers to replace the draft while the question is empty", () => {
    // `startDraftFromSuggestion` replaces the draft wholesale. Offering that
    // mid-sentence is a mis-tap away from destroying somebody's thought.
    const c = code("src/components/IdeasRail.tsx");
    expect(c).toMatch(/getDraft\(\)\.question\.trim\(\)\.length > 0/);
    expect(c).toMatch(/writing \?/);
    const action = c.slice(c.indexOf("writing ?"));
    // The button lives in the NOT-writing branch.
    expect(action.indexOf("onUse")).toBeGreaterThan(action.indexOf("Keep your own question"));
  });

  it("renders nothing rather than padding the column", () => {
    expect(code("src/components/IdeasRail.tsx")).toMatch(/if \(!suggestion\) return null;/);
  });
});

describe("category is the system's business, not the creator's", () => {
  it("collapses the chips out of the primary flow", () => {
    const c = code("src/components/CreateMarket.tsx");
    expect(c).toMatch(/catOpen/);
    // Chips render only inside the opened branch.
    expect(c.indexOf("catOpen ?")).toBeLessThan(c.indexOf("CREATOR_CATEGORIES.map"));
  });

  it("still lets a human confirm it, because that is the only trust signal", () => {
    // `category` stays null until a chip is clicked, and that click is what
    // stamps `category_source: "creator"`. Deleting the chips would delete the
    // classifier's ground truth, so they are demoted rather than removed.
    const c = code("src/components/CreateMarket.tsx");
    expect(c).toMatch(/setCategory\(slug\)/);
    expect(c).toMatch(/CREATOR_CATEGORIES/);
  });

  it("says nothing at all before the reviewer has a guess", () => {
    // No category row on an untouched form — not an empty label, not a
    // placeholder. Absence until there is something true to say.
    const c = code("src/components/CreateMarket.tsx");
    expect(c).toMatch(/activeCategory && \(/);
  });
});

/**
 * THE FORM IS A CONVICTION, NOT A CMS RECORD.
 *
 * Everything below is copy that was in the primary flow and is not any more,
 * asserted absent — because subtraction is only real if it cannot quietly return.
 */
describe("the centre stops selling and asks one thing", () => {
  it("names the act in the title instead of pitching the fee", () => {
    // "Create a Market. Earn 4.5% on Every Trade." put a revenue pitch in the
    // most valuable line on the surface, addressed to somebody who had already
    // decided to create.
    const c = code("src/components/CreateMarket.tsx");
    expect(c).toMatch(/New Market/);
    expect(c).not.toMatch(/Create a Market/);
  });

  it("states the earn once, in the title, and nowhere after", () => {
    // The fee is what the act is worth, so it sits with the act. The post-publish
    // moment says one fact — the market is live — and stops.
    expect(code("src/components/CreateMarket.tsx")).toMatch(/4\.5%/);
    expect(code("src/components/LaunchRail.tsx")).not.toMatch(/4\.5%/);
  });

  it("drops the badge that congratulated the system", () => {
    // "✓ AI-checked" gave the reader no decision and spent the gain colour on
    // housekeeping. The one affordance with an action behind it survives.
    const c = code("src/components/CreateMarket.tsx");
    expect(c).not.toMatch(/AI-checked/);
    expect(c).toMatch(/Polish/);
  });

  it("leaves only the legal line under the primary action", () => {
    // Positioning copy directly beneath the commit button is the one place a
    // reader is deciding rather than being persuaded.
    const c = code("src/components/CreateMarket.tsx");
    expect(c).not.toMatch(/pov\.co|Exclusive/);
    expect(c).toMatch(/Terms/);
  });

  it("keeps the link secondary, inside the field", () => {
    // "Add a link" is an affordance on the question, not a step of its own.
    const c = code("src/components/CreateMarket.tsx");
    expect(c).toMatch(/<AddMedia/);
    expect(c).not.toMatch(/StepLabel>\s*(Add a link|Link|Evidence)/);
  });
});
