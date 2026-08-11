import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const code = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

/**
 * "MY MARKETS" MEANS THE ONES I WROTE — not the ones I hold.
 *
 * The distinction is the whole point of the scope. A creator opens it to see
 * what is happening around their own questions; folding in every market they
 * happen to hold a side in turns it back into a personalised feed, which is
 * what the All Markets scope already is.
 */
describe("My Markets is authorship, not participation", () => {
  const source = () => code("src/lib/insider/source.server.ts");

  it("scopes to markets the viewer authored", () => {
    const s = source();
    const mine = s.slice(s.indexOf('if (data?.scope === "mine")'));
    const body = mine.slice(0, mine.indexOf("let q ="));
    expect(body).toMatch(/from\("markets"\)/);
    expect(body).toMatch(/\.eq\("author_wallet"/);
    // NOT wallet_beliefs — that is what the reader HOLDS, a different question.
    expect(body).not.toMatch(/wallet_beliefs/);
  });

  /**
   * AN IMPOSSIBLE SCOPE IS THE HONEST ANSWER. A blocked read that fell back to
   * every market would put strangers' trades under a heading saying they are
   * yours — the confident fallback this codebase keeps paying for, arriving as
   * a privacy leak rather than a wrong number.
   */
  it("refuses rather than widening when the scope read fails", () => {
    const s = source();
    const mine = s.slice(s.indexOf('if (data?.scope === "mine")'));
    const body = mine.slice(0, mine.indexOf("let q ="));
    expect(body).toMatch(/if \(mineErr\) return \{ \.\.\.EMPTY_SOURCE/);
    expect(body).toMatch(/if \(!data\.wallet\) return \{ \.\.\.EMPTY_SOURCE \}/);
  });
});

/**
 * THE TAPE NEVER NAMES SOMEBODY WHO DID NOT ACT.
 *
 * The same boundary as the Chain view, and it has to be — a leak here would be
 * the same leak arriving through a feed instead of a lineage.
 */
describe("Insider names actors and nobody else", () => {
  it("has no field for a passer, an audience or a waiting recipient", () => {
    const events = code("src/domain/insider/challenge-events.ts");
    const input = events.slice(
      events.indexOf("export interface ChallengeEventInput"),
      events.indexOf("export interface SemanticEvent"),
    );
    for (const forbidden of ["passer", "passed_at", "audience", "waiting", "eligible"])
      expect(input, forbidden).not.toContain(forbidden);
  });

  /**
   * ONE PERSON'S ONE ACT IS ONE EVENT — and the key has to say "act", not
   * "person". Keyed by (market, actor) alone, two relays by the same person
   * merge into one row carrying both reaches at the later timestamp, which the
   * schema permits: `challenges_active_market_idx` is unique only
   * `WHERE closed_at IS NULL`.
   */
  it("collapses mechanical writes rather than reporting each one", () => {
    const events = code("src/domain/insider/challenge-events.ts");
    expect(events).toMatch(/export function collapseEvents/);
    expect(events).toMatch(
      /const key = `\$\{i\.marketId\}\|\$\{i\.actor\.wallet\.toLowerCase\(\)\}\|\$\{i\.actKey \?\? ""\}`/,
    );
  });
});

/**
 * THE SEMANTIC LAYER IS THE ONE THAT SPEAKS.
 *
 * `challenge-events` landed as a domain module with no live caller, which is
 * the exact shape of a correct architecture production never reaches. These
 * assertions are structural on purpose: they fail if the tape ever starts
 * composing a Challenge sentence of its own again.
 */
describe("the tape consumes the Challenge lifecycle rather than restating it", () => {
  const build = () => code("src/lib/insider/build.server.ts");

  it("builds its Challenge rows from semanticEvents", () => {
    const b = build();
    expect(b).toMatch(/import\("@\/domain\/insider\/challenge-events"\)/);
    expect(b).toMatch(/for \(const e of semanticEvents\(inputs\)/);
    // The sentence is taken whole. A row that reformatted it would be a second
    // voice for the same fact.
    expect(b).toMatch(/headline: e\.headline/);
    expect(b).toMatch(/body: e\.support \?\? ""/);
  });

  it("selects the moments in a domain module, not inline in the loader", () => {
    const b = build();
    expect(b).toMatch(/import\("@\/domain\/insider\/challenge-lifecycle"\)/);
    expect(b).toMatch(/lifecycleEvents\(cards, \{/);
  });

  /**
   * NO SECOND ARITHMETIC. Every count in a Challenge row is lifted off the
   * projection; a template literal building one here would be the loader
   * deciding what is true about somebody's branch.
   */
  it("writes no Challenge sentence and counts nothing itself", () => {
    // `code()` strips comments, so these anchors are code — the prose above the
    // block would otherwise be what the assertion was reading.
    const b = build();
    const from = b.indexOf("lifecycleEvents(cards");
    const to = b.lastIndexOf("copyVersion: COPY_VERSION");
    expect(from, "the lifecycle block must exist to be checked").toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const lifecycle = b.slice(from, to);
    for (const forbidden of ["more table", "showed up", "kept it moving", "believer"])
      expect(lifecycle.toLowerCase(), forbidden).not.toContain(forbidden);
  });

  it("keeps the aggregated answer family separate from the new rows", () => {
    // `showedUpInMarket` still owns "3 people showed up for you" — one row per
    // market, so a good day cannot turn the tape into a notification inbox.
    expect(build()).toMatch(/showedUpInMarket\(/);
  });
});
