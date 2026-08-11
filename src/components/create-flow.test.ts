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
  it("shows a spark while writing, not a recruiting desk", () => {
    /**
     * THE SPARK MOVED SIDES, AND THE INVARIANT DID NOT. It used to sit in the
     * right rail; the composer now puts `IdeasRail` on the LEFT — "the everyday
     * rail steps aside so nothing under the composer shifts while the AI thinks"
     * — and gives the right to alternates and markets already being debated.
     *
     * What this test protects is unchanged and is the second assertion: while a
     * question is being written, NEITHER rail recruits. Pinning the old side
     * would have made a deliberate layout decision look like a regression, which
     * is exactly what it did until this was rewritten.
     */
    const route = code("src/routes/index.tsx");
    expect(route).toMatch(/createOpen \? \([\s\S]{0,400}?<IdeasRail/);
    const composing = route.slice(route.indexOf("createOpen || ideaDue ? ("));
    const rail = composing.slice(0, composing.indexOf(") : ("));
    for (const recruiting of ["callReach", "AudiencePreview", "PutOnTable", "Challenge all"])
      expect(rail, recruiting).not.toContain(recruiting);
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

  it("always states what the column is for, and never pads it with filler", () => {
    // The heading is permanent — a writer with no personalised spark still
    // learns the column exists — but every stage below it is narrated rather
    // than invented: invitation, thinking, or an honest empty answer.
    const c = code("src/components/IdeasRail.tsx");
    expect(c).toMatch(/Market ideas/);
    expect(c).toMatch(/Tap a topic above to see ideas\./);
    expect(c).toMatch(/questions…/);
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
    /**
     * THE NUMBER CHANGED, THE RULE DID NOT. The creator's cut is now 1% on all
     * trading, not 4.5% — a deliberate product change, and this assertion caught
     * it as a failure for several merges because it pinned the figure rather
     * than the placement.
     *
     * The rule being protected is WHERE it appears: with the act, once. A fee
     * repeated after publish turns a completed decision back into a pitch. So
     * the title is asserted to carry a percentage, and the post-publish surfaces
     * are asserted to carry none.
     */
    const form = code("src/components/CreateMarket.tsx");
    expect(form).toMatch(/Earn 1% on all trading/);
    // A bare percentage regex would catch `color-mix(... 40%)`, so the test
    // looks for the CLAIM rather than the character: an earn, a fee, a cut.
    for (const f of ["src/domain/post-action.ts", "src/components/PostActionScreen.tsx"])
      expect(code(f), f).not.toMatch(/\bEarn\b|\bfee\b|\bcut\b|on all trading/i);
    // The post-publish moment is `resolvePostAction`'s create branch now, and it
    // says one fact — the market is live — with no fee repeated after the act.
  });

  it("drops the badge that congratulated the system", () => {
    // "✓ AI-checked" gave the reader no decision and spent the gain colour on
    // housekeeping. The one affordance with an action behind it survives.
    const c = code("src/components/CreateMarket.tsx");
    expect(c).not.toMatch(/AI-checked/);
    /**
     * AND "POLISH" WENT WITH IT. The test used to assert that the one affordance
     * with an action behind it SURVIVED — then the form stopped rendering AI
     * feedback altogether ("NO AI FEEDBACK RENDERS IN THE FORM"), which is a
     * larger version of the same decision rather than a reversal of it. The
     * assertion now matches the code: no inline rewrite, no badge.
     */
    expect(c).not.toMatch(/Polish/);
  });

  it("leaves only the legal line under the primary action", () => {
    // Positioning copy directly beneath the commit button is the one place a
    // reader is deciding rather than being persuaded.
    const c = code("src/components/CreateMarket.tsx");
    expect(c).not.toMatch(/pov\.co|Exclusive/);
    /**
     * NOTHING AT ALL IS LEFT UNDER THE BUTTON NOW, INCLUDING TERMS. The link was
     * removed on the same reasoning that removed the positioning copy — the one
     * place a reader is deciding rather than being persuaded is directly beneath
     * the commit, and Terms stay reachable from the app menu. Asserting the link
     * still present contradicted the comment three lines above it in the source.
     */
    expect(c).not.toMatch(/Terms/);
  });

  it("keeps the link secondary, inside the field", () => {
    // "Add a link" is an affordance on the question, not a step of its own.
    const c = code("src/components/CreateMarket.tsx");
    expect(c).toMatch(/<AddMedia/);
    expect(c).not.toMatch(/StepLabel>\s*(Add a link|Link|Evidence)/);
  });
});
