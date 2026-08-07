import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

/**
 * THE READER'S QUESTION IS "WHY AM I LOOKING AT THIS?"
 *
 * The centre used to answer a different one. A momentum chip sat in the
 * top-right — HOT, Early, Hidden, Contested, Conviction, New; six labels, six
 * hues — describing the MARKET's own temperature in the loudest corner of the
 * card, while the sentence composed for THIS reader by `reasonFor` sat in muted
 * grey underneath it.
 *
 * The chip is gone and the sentence takes the emphasis, in `--rel`: the accent
 * that already means "this one is about you" everywhere else in the product (the
 * live-tape wash on a network row, the "In this market" rail, the relationship
 * spectrum). No seventh colour was invented.
 */
describe("the momentum chip is gone", () => {
  const deck = code("src/components/MarketDeck.tsx");

  it("no longer keeps a label/hue table for opportunity types", () => {
    expect(deck).not.toMatch(/MOMENTUM\s*:\s*Record/);
    expect(deck).not.toMatch(/chipTone|chipLabel|chipHint/);
  });

  it("does not reintroduce the six hard-coded hues", () => {
    // The chip's palette — orange/cyan/violet/rose/green/slate — was six brand
    // colours that existed only here and meant nothing anywhere else.
    for (const hue of ["#f97316", "#22d3ee", "#f43f5e", "#34d399", "#94a3b8"]) {
      expect(deck, hue).not.toContain(hue);
    }
  });

  it("keeps a floor under the header row so the title still cannot shift", () => {
    // Removing the chip must not remove the RESERVATION: a market with no
    // category would otherwise sit its title higher than one with a category.
    //
    // Spelled as a custom property since the responsive pass, so the height can
    // retune with the column while staying reserved. The property is what
    // matters — this guard used to demand the literal class and broke on an
    // improvement, which is a tax rather than a protection.
    expect(deck).toMatch(/min-h-\[22px\]|--deck-meta, ?22px/);
  });
});

describe("Why this is one component, in one colour, on both surfaces", () => {
  const why = code("src/components/WhyThis.tsx");

  it("uses the discovery accent rather than a new colour", () => {
    expect(why).toMatch(/var\(--rel/);
  });

  it("renders nothing when there is no honest reason to give", () => {
    // `reasonFor` returns null when nothing true can be said; a "Why this" label
    // with no reason after it would be chrome promising an answer it lacks.
    expect(why).toMatch(/if \(!reason\) return null/);
  });

  it("is what the centre renders", () => {
    const deck = code("src/components/MarketDeck.tsx");
    expect(deck).toMatch(/<WhyThis reason=\{reason\} lead \/>/);
    // And no longer builds its own muted version inline.
    expect(deck).not.toMatch(/uppercase tracking-\[0\.08em\] opacity-70/);
  });

  it("tells the active market's reason exactly once, and the centre tells it", () => {
    /**
     * THE PROPERTY, NOT THE PLACE — this assertion has now been wrong twice for
     * the same reason, so it is written about the invariant instead.
     *
     * The reason belongs to ONE surface at a time. It has lived in a "Now
     * reading" card, then in the rail's "In this market", and now in the centre
     * panel above the question. Every one of those is defensible; two of them at
     * once is not, because the reader sees the same sentence in two columns and
     * neither looks authoritative.
     *
     * So: the centre says it (labelled, `lead`), the playlist says it for rows
     * that are NOT active — `upcoming` filters the active one out — and no third
     * surface repeats it.
     */
    const feed = code("src/components/FeedListPanel.tsx");
    const deck = code("src/components/MarketDeck.tsx");
    const rail = code("src/components/CurrentMarketActivity.tsx");

    // The centre owns the active market's reason.
    expect(deck).toMatch(/<WhyThis reason=\{reason\} lead \/>/);
    // The playlist explains the rows the reader has not reached yet.
    expect((feed.match(/<WhyThis/g) ?? []).length).toBe(1);
    expect(feed).toMatch(/const upcoming = entries\.filter\(\(e\) => e\.onchainId !== activeId\)/);
    // And nobody says it a second time.
    expect(rail).not.toMatch(/<WhyThis/);
    expect(feed).not.toMatch(/\{line\}\s*<\/span>/);
    expect(code("src/components/WhyThis.tsx")).toMatch(/export function WhyThis/);
  });

  it("names itself only where a label earns its space", () => {
    // The centre labels it (one sentence above a large title). The feed does
    // not: every row carries one, so a label per row is chrome repeating what
    // the column already says.
    expect(code("src/components/MarketDeck.tsx")).toMatch(/lead/);
    const feed = code("src/components/FeedListPanel.tsx");
    expect(feed).not.toMatch(/<WhyThis[^>]*\slead\b/);
  });
});
