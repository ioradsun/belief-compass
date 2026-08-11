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
const tape = readFileSync(resolve(process.cwd(), "src/lib/insider/build.server.ts"), "utf8");

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

  /**
   * THIS TEST WAS RIGHT AND ITS METHOD STOPPED BEING ACHIEVABLE.
   *
   * It asserted no row removal below the question stage, and named the exact
   * consequence: "a rationed question can vanish." It then went red and was
   * carried as baseline for several merges — during which the thing it warned
   * about was live. A de-duplication pass now runs after rationing, drops a
   * question-carrying card whose verbatim twin outranks it, and the ledger went
   * on reporting that question as kept.
   *
   * The structural rule cannot come back: the question layer rewrites bodies, so
   * de-duplication has to run after it or it compares the wrong text. So the
   * assertion moves from the SHAPE to the RULE — whatever removes rows, the
   * ledger must agree with what survived.
   */
  it("never reports a question as kept on a row that was removed", () => {
    const after = src.slice(ration());
    const removals = [...after.matchAll(/\.splice\(|editFeed\(/g)];
    if (removals.length === 0) return; // nothing below the stage: rule holds trivially
    // Every removal below the question stage must be reconciled against the ledger.
    expect(after).toMatch(
      /for \(const e of questionLedger\) if \(dup\.has\(e\.id\)\) e\.kept = false/,
    );
    // And the reconciliation must come AFTER the removal, not before it.
    expect(after.indexOf("e.kept = false")).toBeGreaterThan(after.lastIndexOf(".splice("));
  });

  it("keeps a promoted person pattern readable by the question layer", () => {
    expect(src).toMatch(/patternById/);
    expect(src).toMatch(/pattern: r\.story\.pattern \?\? patternById\.get\(r\.id\)/);
  });

  it("runs the pass from the tape, after narration composed the copy", () => {
    expect(tape).toMatch(/runEditorialPass\(/);
    expect(tape.indexOf("runEditorialPass(")).toBeGreaterThan(tape.indexOf("runNarrationPass({"));
  });
});
