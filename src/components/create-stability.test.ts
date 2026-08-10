import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Comments stripped: these files EXPLAIN what they moved, in the words they moved. */
const code = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

/**
 * THE NEW-MARKET FORM MUST NOT JUMP WHILE THE AI THINKS.
 *
 * The form used to render the AI's opinion inside itself: a "Polish" rewrite and
 * a rejection reason that both appeared a beat after the writer paused typing —
 * `reviewMarketQuestion` is debounced 500ms — and neither reserved space, so the
 * fields below them moved every time the reader stopped to think. That help now
 * lives in the right rail (AlternatesRail), and the one AI-driven thing that
 * stays (the category guess) sits in a height-reserved slot.
 *
 * These are source-shape guards, the same kind rail-stability.test uses: they
 * cannot measure pixels, but they lock in the structure that keeps the surface
 * still — no inline review UI, a reserved category slot, and the rewrites in the
 * rail instead.
 */
describe("the create form does not move while the AI reviews", () => {
  const form = code("src/components/CreateMarket.tsx");

  it("renders no inline AI feedback — the jump is gone with it", () => {
    // The two async strings that used to push the fields down.
    expect(form).not.toMatch(/review\.review\.suggestion/);
    expect(form).not.toMatch(/review\.review\.reason/);
    // And the control they powered.
    expect(form).not.toMatch(/>\s*Polish\s*</);
  });

  it("keeps the category guess, but in a height-reserved slot", () => {
    // The guess still pre-fills (the ground-truth click is the whole reason the
    // category control exists) …
    expect(form).toMatch(/suggestedCategory/);
    // … but the slot reserves its height so populating it cannot shift the form.
    expect(form).toMatch(/min-h-\[20px\]/);
  });

  it("no longer sends the writer out to Terms mid-commit", () => {
    expect(form).not.toMatch(/>\s*Terms\s*</);
    expect(form).not.toMatch(/onOpenTerms/);
    expect(form).not.toMatch(/\/terms/);
  });

  it("accepts an alternate adopted from the rail, in place", () => {
    expect(form).toMatch(/useAdoptedQuestion/);
  });
});

/**
 * THE HELP MOVED TO THE RAIL, AND IT IS A CHOICE NOW.
 *
 * One rewrite under the field was not a choice; 2–3 alternates beside it are.
 * The rail reads the same debounced probe the neighbour search does and writes
 * an adoption back through the draft store, so it never reaches into the form.
 */
describe("the alternates rail owns the rewrites", () => {
  const rail = code("src/components/AlternatesRail.tsx");
  const draft = code("src/lib/create-draft.ts");
  const idx = code("src/routes/index.tsx");

  it("reads the live probe and asks the server for alternates", () => {
    expect(rail).toMatch(/useSuggestionProbe/);
    expect(rail).toMatch(/suggestAlternateQuestions/);
  });

  it("adopts a pick back into the form through the draft store", () => {
    expect(rail).toMatch(/adoptQuestion\(/);
    expect(draft).toMatch(/export function adoptQuestion/);
    expect(draft).toMatch(/export function useAdoptedQuestion/);
  });

  it("stacks alternates with the House spark while creating", () => {
    expect(idx).toMatch(/<AlternatesRail/);
    expect(idx).toMatch(/<IdeasRail/);
  });
});
