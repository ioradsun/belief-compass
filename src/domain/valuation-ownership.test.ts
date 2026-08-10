import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * REGRESSION 2 — ONE VALUATION MODULE, NOT FOUR OPINIONS.
 *
 * `wallet_beliefs.yes_value_usd` / `no_value_usd` are columns with no writer
 * history and, until the belief-rollup fix, no writer at all. Four separate
 * surfaces read them directly and each independently did `Number(x) || 0`,
 * which is how one empty column silently emptied conviction cohorts, the
 * standing-fact pool, whale detection, and the dashboard's held count.
 *
 * The failure was not that any one of them was wrong. It was that the RULE for
 * "what is this position worth" lived in four places, so fixing it in one would
 * have left three. This test asserts the rule has exactly one home: any file
 * that reads the raw column must do so through `positionValueUsd`.
 *
 * It reads source rather than behaviour on purpose. The bug was structural —
 * duplicated knowledge — and only a structural check catches its return.
 */
const READERS = [
  "src/lib/conviction-cohort-emit.server.ts",
  "src/lib/standing-facts.server.ts",
  "src/lib/evidence.functions.ts",
  "src/lib/conviction-dashboard.server.ts",
];

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("every consumer of a belief's value goes through the shared module", () => {
  for (const file of READERS) {
    it(`${file} imports positionValueUsd`, () => {
      expect(read(file)).toContain('from "@/domain/position-value"');
    });

    /**
     * The precise shape of the original bug: coercing the raw column straight
     * to a number, so NULL becomes a confident zero.
     */
    it(`${file} never coerces the raw column itself`, () => {
      const src = read(file);
      const raw = [
        /Number\(\s*\w+\.(yes|no)_value_usd/,
        /num\(\s*\w+\.(yes|no)_value_usd/,
        /\b(yes|no)_value_usd\s*\?\?\s*0/,
      ];
      for (const pattern of raw) expect(src).not.toMatch(pattern);
    });

    /**
     * A valuation with no provenance cannot report freshness, and a reader that
     * cannot tell current from stale from fallback is back where it started.
     */
    it(`${file} selects value_updated_at alongside the value`, () => {
      const src = read(file);
      if (!src.includes("_value_usd")) return;
      expect(src).toContain("value_updated_at");
    });
  }

  it("the writer persists the value it computes, with its provenance", () => {
    // `evaluate()` produced yes_value/no_value and this job threw them away —
    // the actual root cause. Persisting them is what makes the fallback
    // temporary rather than permanent infrastructure.
    const src = read("src/routes/api/public/jobs/belief-rollup.ts");
    expect(src).toContain("yes_value_usd: v.yes_value");
    expect(src).toContain("no_value_usd: v.no_value");
    expect(src).toContain('value_source: "marked"');
    expect(src).toContain("value_updated_at");
  });

  it("the writer never writes a valuation it does not have", () => {
    // A market with no observed price on EITHER side must leave the last known
    // value alone. Writing zero would re-create the original bug from the other
    // direction. One priced side is enough: a side nobody has bought holds no
    // shares for anyone, so its missing price understates nothing.
    const src = read("src/routes/api/public/jobs/belief-rollup.ts");
    expect(src).toMatch(/canMark\s*=\s*p\.yesPriceUsd\s*>\s*0\s*\|\|\s*p\.noPriceUsd\s*>\s*0/);
    expect(src).toMatch(/\.\.\.\(canMark/);
  });
});
