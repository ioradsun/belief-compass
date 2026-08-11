import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const code = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

const cta = () => code("src/components/PutOnTable.tsx");
const launch = () => code("src/components/LaunchRail.tsx");

describe("one action, both paths", () => {
  it("keeps the launch moment to one fact", () => {
    // The put-it-up prompt used to live here, which turned a confirmation into a
    // briefing. It moved into the Challenge column, where a free slot is an
    // invitation carrying its own market and can actually be acted on.
    const c = launch();
    expect(c).not.toMatch(/<PutOnTable/);
    expect(c).toMatch(/Your market is live\./);
  });

  it("keeps the confirmation a confirmation", () => {
    // No card list, no 3/3 widget, no replace-selector. Choosing what to take
    // down needs to see all three, which belongs in Challenge.
    const c = cta();
    expect(c).not.toMatch(/map\(|replace|swap|3 \/ 3|of 3/i);
  });
});

describe("it refuses to ask when the answer is no", () => {
  it("says nothing useful is possible when nobody qualifies", () => {
    // Inviting somebody to put a question in front of an audience that does not
    // exist is worse than silence.
    expect(cta()).toMatch(/no_audience/);
    expect(cta()).toMatch(/Nobody new to ask here yet/);
    /**
     * `no_reach` SHARES THE SENTENCE, because to the reader it is one fact: the
     * write landed on nobody. They differ only in where it was discovered — one
     * before the transaction opened, one inside it after everybody in the
     * audience turned out to already have a row. Both rolled back, neither spent
     * a slot, and a second wording for the same outcome would be two ways of
     * saying nothing happened.
     */
    expect(cta()).toMatch(/no_reach/);
    // NOT "as your Tribe and Rivals form". There are three groups now, and a
    // sentence naming two of them tells somebody whose whole network is Still
    // Forming that they do not have one.
    expect(cta()).not.toMatch(/Tribe and Rivals form/);
  });

  it("distinguishes a refused audience from an empty one", () => {
    /**
     * A failed exclusion read is not "nobody qualifies". That sentence sounds
     * permanent and blames the reader's network for an outage — and the server
     * refused precisely so that nothing was written, so the honest thing to say
     * is that it did not go through.
     */
    const c = cta();
    expect(c).toMatch(/audience_unavailable/);
    expect(c).toMatch(/Couldn&rsquo;t work out who this would reach/);
    expect(c).toMatch(/Nothing was put up/);
  });

  it("points at the table at capacity instead of offering a failing button", () => {
    const c = cta();
    expect(c).toMatch(/Your table&rsquo;s full/);
    expect(c).toMatch(/See yours/);
    expect(c).toMatch(/canPutOnTable\(active\)/);
  });

  it("will not offer a second slot for a market already up", () => {
    // The unique index would reject it; saying so beats a button that fails.
    const c = cta();
    expect(c).toMatch(/alreadyUp/);
    expect(c).toMatch(/On the table\./);
  });

  it("reads the cap from the canonical helper, never its own arithmetic", () => {
    const c = cta();
    expect(c).toMatch(/canPutOnTable/);
    expect(c).not.toMatch(/active < 3|>= 3|TABLE_SLOTS -/);
  });
});

describe("the words", () => {
  it("asks for a take, never for agreement", () => {
    const c = cta();
    expect(c).toMatch(/Want your people&rsquo;s take\?/);
    expect(c).toMatch(/Put it on the table/);
    for (const w of ["agree", "invite", "accept", "credits", "allowance"])
      expect(c.toLowerCase()).not.toContain(w);
  });
});
