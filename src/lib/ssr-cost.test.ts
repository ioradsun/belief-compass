import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cosine, EMPTY_PROFILE } from "@/domain/feed/score";

/**
 * THE SSR PATH DOES NOT PAY FOR WHAT IT CANNOT USE.
 *
 * The `/` loader awaits the anonymous feed, so whatever that build reads IS the
 * first-paint TTFB for a first-time visitor. Anything on it that cannot affect
 * the output is not a small inefficiency — it is latency charged to the one
 * request that decides whether the page feels instant or broken.
 *
 * The specific case: `market_ai_analysis.embedding` is the one wide column in
 * that table, a vector per market, and it has exactly one consumer —
 * `cosine(viewer.tasteEmbedding, ai.embedding)`. An anonymous viewer gets
 * `EMPTY_PROFILE`, whose `tasteEmbedding` is null BY CONSTRUCTION, and `cosine`
 * returns 0 the moment either side is null. So on the SSR path every embedding
 * was fetched, transferred and parsed to be multiplied by nothing.
 *
 * This is easy to undo by accident. The select is one string, and adding a
 * column to it looks harmless — the page still renders correctly, it just
 * renders later, and nothing fails. That is the worst kind of regression: no
 * error, no wrong output, only a slower first paint that shows up as a vague
 * "the site feels slow" weeks afterwards.
 */
describe("an anonymous render cannot use an embedding, so it must not fetch one", () => {
  const src = readFileSync(
    join(new URL("./", import.meta.url).pathname, "feed/viewer-signals.server.ts"),
    "utf8",
  );

  it("proves the term is structurally zero without a viewer vector", () => {
    // Not a claim about today's data — a property of the function. Any
    // embedding at all, against a viewer who has none, scores nothing.
    expect(EMPTY_PROFILE.tasteEmbedding).toBeNull();
    expect(cosine(EMPTY_PROFILE.tasteEmbedding, [0.1, 0.2, 0.3])).toBe(0);
    expect(cosine(null, null)).toBe(0);
  });

  it("keeps `embedding` out of the default column list", () => {
    const cols = /const ANALYSIS_COLUMNS\s*=\s*([\s\S]*?);/.exec(src);
    expect(cols, "ANALYSIS_COLUMNS not found").not.toBeNull();
    expect(cols![1]).not.toMatch(/\bembedding\b/);
  });

  it("adds it only behind the flag, never unconditionally", () => {
    // The select must remain conditional. A plain `"…, embedding"` would put
    // the vector back on every request including SSR.
    expect(src).toMatch(/withEmbedding\s*\?\s*`\$\{ANALYSIS_COLUMNS\}, embedding`/);
  });

  it("defaults to NOT fetching it, so a new caller is cheap by default", () => {
    // The safe default matters more than the flag: the next person to call this
    // will not pass an argument, and the cheap path is the one they should get.
    expect(src).toMatch(/withEmbedding\s*=\s*false/);
  });

  it("is asked for the vector only when a wallet is present", () => {
    const feed = readFileSync(
      join(new URL("./", import.meta.url).pathname, "opportunity-feed.server.ts"),
      "utf8",
    );
    expect(feed).toMatch(/loadMarketAnalyses\(ids,\s*Boolean\(wallet\)\)/);
  });
});
