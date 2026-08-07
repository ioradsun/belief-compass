import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { COLLAPSE_MS } from "./Collapsible";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
/** Comments stripped: these files EXPLAIN what they removed. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

/**
 * THE RIGHT RAIL MUST NOT TELEPORT.
 *
 * The rail is a flex column — welcome card, market-activity card, "Now", then a
 * `flex-1` live tape. Because the tape absorbs the residual height, ANY block
 * above it changing height moves the heading and resizes the reader's window
 * onto the feed. `return null` is the worst version: a whole card leaves in one
 * frame and takes ~70px of the column with it.
 *
 * Measured on /dev/rail (scripts/measure-rail.mjs), before → after:
 *
 *   activity card appears      67px in 1 step   →  73px over 11 steps / 197ms
 *   activity card disappears   67px in 1 step   →  73px over 11 steps / 186ms
 *   latest beat rewraps        36px in 1 step   →  0px, one tape height
 *   welcome card disappears   119px in 1 step   → 103px over 11 steps / 186ms
 *   expand "In this market"    full-column overlay → 288px downward, in place
 *
 * The distinction that matters is steps, not pixels. One step is a
 * discontinuity — the eye cannot connect the before and the after, which is what
 * "jumping" means. Eleven steps over ~190ms is a movement, which it can. The
 * beat rewrap is the one that had to reach zero, because it fires on its own
 * while a reader is watching an active market and nobody touched anything.
 */
describe("nothing in the right rail changes height instantly", () => {
  it("the activity card collapses instead of unmounting", () => {
    const c = code("src/components/CurrentMarketActivity.tsx");
    expect(c).toMatch(/Collapsible/);
    // The specific regression: `if (count === 0) return null`.
    expect(c).not.toMatch(/count === 0\)?\s*return null/);
  });

  it("the welcome card collapses instead of unmounting", () => {
    const c = code("src/components/Welcome.tsx");
    expect(c).toMatch(/Collapsible/);
    expect(c).not.toMatch(/!wallet \|\| count === 0\) return null/);
  });

  it("the latest beat reserves both of its lines", () => {
    // `line-clamp-2` without a reserved height means the card is one line tall
    // or two depending on the sentence — and the sentence changes on its own.
    const c = code("src/components/CurrentMarketActivity.tsx");
    expect(c).toMatch(/BEAT_MIN_H/);
    expect(c).toMatch(/minHeight: BEAT_MIN_H/);
  });

  it("expanding never resizes the column the reader is looking at", () => {
    const c = code("src/components/CurrentMarketActivity.tsx");
    /**
     * THE PROPERTY, NOT THE MECHANISM — and this test used to get that wrong.
     *
     * It banned `createPortal` outright, because the ORIGINAL bug was a portal
     * into a `fixed inset-0` sheet with a scrim that replaced the whole column.
     * The fix then was to expand in place. A later responsive pass moved it back
     * to a portal — but an ANCHORED one, positioned at this card's own left/top/
     * width with a transparent catcher — which satisfies the actual requirement
     * (the rail does not move) better than expanding in place did, because a
     * portal cannot change the column's height at all, and it escapes the
     * ancestor `overflow-hidden` that clipped the in-place version.
     *
     * So the guard now asserts what must be true: the panel is positioned
     * against this card, not stretched over the viewport.
     */
    expect(c).not.toMatch(/aria-modal/);
    // A full-bleed SHEET is still banned; a full-bleed transparent catcher for
    // outside-taps is not the same thing and is how every menu closes.
    expect(c).not.toMatch(/fixed inset-0[^"]*bg-|backdrop-blur/);
    expect(c).toMatch(/anchor\?\.(left|top|width)/);
  });

  it("the expanded feed is bounded so it can never run off the screen", () => {
    const c = code("src/components/CurrentMarketActivity.tsx");
    expect(c).toMatch(/EXPANDED_MAX/);
    // Bounded by the card's budget AND by what is left of the viewport below
    // it — a literal `maxHeight: EXPANDED_MAX` was the old spelling of this.
    expect(c).toMatch(/maxHeight:[^,}]*EXPANDED_MAX/);
  });
});

describe("the collapse primitive", () => {
  const c = code("src/components/Collapsible.tsx");

  it("animates to intrinsic height rather than a guessed maximum", () => {
    // `max-height` is the usual hack and is always either too small (clips) or
    // too large (animates a phantom gap at the wrong speed). `0fr → 1fr`
    // resolves to the content's own size.
    expect(c).toMatch(/gridTemplateRows/);
    expect(c).toMatch(/0fr/);
    expect(c).toMatch(/1fr/);
    expect(c).not.toMatch(/maxHeight/);
  });

  it("can actually reach zero", () => {
    // A grid item defaults to `min-height: auto` and refuses to shrink below
    // its content, so without this the block leaves a ghost behind.
    expect(c).toMatch(/min-h-0/);
  });

  it("honours reduced motion by resolving at once, not by breaking layout", () => {
    expect(c).toMatch(/motion-reduce:transition-none/);
  });

  it("keeps collapsed content out of the keyboard order and the a11y tree", () => {
    // Still mounted — unmounting throws away scroll position, input state and
    // query observers — but genuinely unreachable while invisible.
    expect(c).toMatch(/inert/);
    expect(c).toMatch(/aria-hidden/);
  });

  it("moves at a speed a reader can follow, and no slower", () => {
    expect(COLLAPSE_MS).toBeGreaterThanOrEqual(120);
    expect(COLLAPSE_MS).toBeLessThanOrEqual(320);
  });
});

/**
 * THE UPDATE CONTROL SHARES THE HEADING'S LINE.
 *
 * It used to be `sticky top-0 mb-2` INSIDE the tape's scroller, so it pushed
 * every row down ~38px when activity arrived and the rows snapped back the
 * instant it was tapped — a jump on arrival, and a second one on the very tap
 * that was meant to be the calm, deliberate act. The reader's own click moved
 * the thing they were aiming at.
 *
 * Measured on /dev/rail, before → after:
 *   update control appears   38px in 1 step → 0px, 0 CLS
 *   update control is tapped 38px in 1 step → 0px, 0 CLS
 */
describe("the update control never moves the feed", () => {
  const c = code("src/components/LiveTape.tsx");

  it("lives in a fixed-height header beside the label, not in the scroller", () => {
    expect(c).toMatch(/label\?: string/);
    // A fixed-height row: the slot exists whether or not the control does.
    expect(c).toMatch(/h-\[26px\]/);
    expect(c).not.toMatch(/sticky top-0/);
  });

  it("fades rather than mounting, so the slot never reflows", () => {
    expect(c).toMatch(/opacity: gate\.pending > 0/);
    expect(c).toMatch(/pointerEvents/);
  });

  it("is unreachable by keyboard when there is nothing to admit", () => {
    expect(c).toMatch(/tabIndex=\{gate\.pending === 0 \? -1/);
    expect(c).toMatch(/aria-hidden=\{gate\.pending === 0/);
  });

  it("the rail hands the heading to the tape rather than rendering its own", () => {
    const idx = code("src/routes/index.tsx");
    expect(idx).toMatch(/label="Now"/);
  });

  it("still holds every update until the reader asks", () => {
    // holdUpdates → useTapeGate(holdAlways), which admits only on first paint.
    expect(code("src/routes/index.tsx")).toMatch(/holdUpdates/);
    expect(code("src/hooks/useTapeGate.ts")).toMatch(/!holdAlways && canAutoAdmit/);
  });

  it("puts the rows the reader asked for at the very top", () => {
    const gate = code("src/hooks/useTapeGate.ts");
    expect(gate).toMatch(
      /\.\.\.taking, \.\.\.collapse\(incomingRef\.current as T\[\]\), \.\.\.prev/,
    );
  });
});

/**
 * A MARKET'S NAME IS NOT ITS ID. "Market #123" reads as a deliberate
 * placeholder and is indistinguishable from a market that genuinely has no
 * title — it is neither, it is a failed join.
 */
describe("market titles", () => {
  const c = code("src/lib/live.functions.ts");

  it("never stores an empty string as a title", () => {
    // `set(id, title ?? "")` made the map return a present-but-empty string,
    // which survives BOTH `?? null` here and `?? \`Market #\`` downstream — so
    // the row rendered blank instead of either the title or the fallback. The
    // blank-check now lives in the shared lookup, which nulls empty titles.
    expect(c).toMatch(/if \(m\.title\) titleById\.set/);
    expect(c).toMatch(/fetchMarketNames\(sb, marketIds\)/);
  });

  it("says so when a title does not resolve, instead of shipping the id", () => {
    expect(c).toMatch(/market titles did not resolve/);
  });
});
