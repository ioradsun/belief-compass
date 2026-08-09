/**
 * A STAGE-ORDER INVARIANT, ENFORCED ON THE SOURCE.
 *
 * The question layer's unit tests all passed while production asked almost
 * nothing, because the bug was not in any function — it was in where the stage
 * sat. Questions were drafted and rationed BEFORE editorial subtraction (so the
 * three slots could be spent on rows that were then deleted, leaving the
 * rendered feed with none) and BEFORE person patterns were composed (so the
 * PERSON question was asked about a pattern that did not exist yet).
 *
 * Nothing about that is visible to a unit test of `piQuestion` or `editFeed`,
 * so the ordering itself is the thing under test here: the rationer must see
 * exactly the corpus the reader sees.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* The stages now live in one pure pass; the tape only calls it. Both files are
   read so the invariant survives the extraction. */
const src = readFileSync(
  resolve(process.cwd(), "src/lib/insider/composition/editorial-pass.ts"),
  "utf8",
);
const tape = readFileSync(resolve(process.cwd(), "src/lib/live.functions.ts"), "utf8");

const at = (needle: string): number => {
  const i = src.indexOf(needle);
  expect(i, `pipeline marker missing: ${needle}`).toBeGreaterThan(-1);
  return i;
};

describe("questions are rationed over the rows that actually render", () => {
  const subtraction = () => at("editFeed(");
  const patterns = () => at("findPersonPatterns(");
  const draft = () => at("piQuestion({");
  const ration = () => at("rationQuestions(");

  it("drafts questions only after editorial subtraction", () => {
    expect(draft()).toBeGreaterThan(subtraction());
  });

  it("rations questions only after editorial subtraction", () => {
    expect(ration()).toBeGreaterThan(subtraction());
  });

  it("drafts questions only after person patterns exist", () => {
    expect(draft()).toBeGreaterThan(patterns());
  });

  it("rations after drafting", () => {
    expect(ration()).toBeGreaterThan(draft());
  });

  it("removes no rows after the question budget is spent", () => {
    // The only row removal in the tape is the editorial splice. If another one
    // ever appears below the question stage, a rationed question can vanish.
    const after = src.slice(ration());
    expect(after).not.toMatch(/\.splice\(/);
    expect(after).not.toMatch(/editFeed\(/);
  });

  it("keeps a promoted person pattern readable by the question layer", () => {
    expect(src).toMatch(/patternById/);
    expect(src).toMatch(/pattern: r\.story\.pattern \?\? patternById\.get\(r\.id\)/);
  });
});
