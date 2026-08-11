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

  it("collapses mechanical writes rather than reporting each one", () => {
    const events = code("src/domain/insider/challenge-events.ts");
    expect(events).toMatch(/export function collapseEvents/);
    // Keyed by market AND actor: one person's one act in one market is one event.
    expect(events).toMatch(
      /const key = `\$\{i\.marketId\}\|\$\{i\.actor\.wallet\.toLowerCase\(\)\}`/,
    );
  });
});
