import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { insiderNowKey } from "@/lib/insider/keys";

const code = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

/**
 * ALL MARKETS | MY MARKETS — one event system with a scope, not two feeds.
 *
 * Every assertion below is a way the second feed could grow back: a separate
 * endpoint, a separate cache, a separate definition of who owns a market, or a
 * poll that quietly widens the scope it was given.
 */
describe("the scope is a filter on the one tape, not a second one", () => {
  it("travels on the tape's own input schema", () => {
    const c = code("src/lib/insider/tape-input.ts");
    expect(c).toMatch(/scope: z\.enum\(\["all", "mine"\]\)\.optional\(\)/);
    // No second server function, no second route, no second builder.
    expect(code("src/lib/live.functions.ts")).not.toMatch(/myMarkets|mineTape|listMyEvents/i);
  });

  it("resolves ownership from the one column that already says who asked", () => {
    // markets.author_wallet is the Market Maker, and it is the same column the
    // creator lookup and tableCandidates already read. A second definition of
    // "my market" is how two surfaces start disagreeing about whose it is.
    const c = code("src/lib/insider/source.server.ts");
    expect(c).toMatch(/author_wallet/);
    expect(c).not.toMatch(/owner_wallet|maker_wallet/);
  });

  it("never widens an empty My Markets into the whole network", () => {
    // The confident fallback this codebase keeps paying for, and here it would
    // put strangers' trades under a heading saying they are yours.
    const c = code("src/lib/insider/source.server.ts");
    const block = c.slice(c.indexOf('if (data?.scope === "mine")'));
    expect(block).toMatch(/if \(!data\.wallet\) return \{ \.\.\.EMPTY_SOURCE \}/);
    expect(block).toMatch(/if \(scope\.length === 0\) return \{ \.\.\.EMPTY_SOURCE \}/);
  });
});

describe("one reader's markets can never be served to another", () => {
  it("keeps the My Markets read out of the viewer-blind source cache", () => {
    // The whole cache rests on the source half not depending on the wallet.
    // `mine` breaks that on purpose, so it must skip the cache — adding the
    // wallet to the key would "fix" it and destroy what the cache is for.
    const c = code("src/lib/insider/source-cache.server.ts");
    expect(c).toMatch(/data\?\.since \|\| data\?\.scope === "mine"/);
    // The key itself stays viewer-blind.
    expect(
      c.slice(c.indexOf("export function sourceCacheKey"), c.indexOf("export async function")),
    ).not.toMatch(/wallet|scope\b.*mine/);
  });

  it("gives the two scopes different cache keys", () => {
    const all = JSON.stringify(insiderNowKey({ wallet: "0xa", scope: "all" }));
    const mine = JSON.stringify(insiderNowKey({ wallet: "0xa", scope: "mine" }));
    expect(all).not.toBe(mine);
    // And an unset scope is byte-identical to "all", so shipping this orphans
    // no cached tape that was written before the filter existed.
    expect(JSON.stringify(insiderNowKey({ wallet: "0xa" }))).toBe(all);
  });

  it("carries the scope on the delta poll, not just the full fetch", () => {
    // Without it a My Markets poll asks for the WHOLE network since that
    // timestamp and merges strangers onto a tail the reader was told was theirs.
    const c = code("src/components/LiveTape.tsx");
    const from = c.indexOf("const sinceIso");
    const delta = c.slice(from, c.indexOf("mergeLiveRows", from));
    expect(delta).toMatch(/\.\.\.\(scope \? \{ scope \} : \{\}\)/);
  });
});

describe("My Markets is raw, and All Markets is unchanged", () => {
  it("drops the significance floor only for the scoped column", () => {
    const c = code("src/lib/insider/build.server.ts");
    expect(c).toMatch(/admitEverything: mine/);
    // The flag is a branch inside the one pass, never a second pass.
    const pass = code("src/lib/insider/composition/significance-pass.ts");
    expect(pass).toMatch(/return admitEverything \|\| a !== null/);
    expect(pass.match(/export function runSignificancePass/g) ?? []).toHaveLength(1);
  });

  it("ranks nothing in My Markets, so the order stays chronological", () => {
    // The events query is already occurred_at DESC. One flat significance
    // leaves that order alone rather than teaching the mixer a second mode.
    expect(code("src/lib/insider/build.server.ts")).toMatch(
      /significance: mine\s*\?\s*FLAT_SIGNIFICANCE/,
    );
  });

  it("still collapses a burst, so one person cannot flood the column", () => {
    // Grouping is upstream of admission and is deliberately untouched: three
    // adds by one person inside the window stay one row.
    const c = code("src/lib/insider/build.server.ts");
    expect(c).toMatch(/groupLiveRows/);
    expect(c).not.toMatch(/mine \?[^:]*groupLiveRows|skipGrouping/);
  });
});

describe("YOUR MARKET marks an exception, and only where there is one", () => {
  it("reads the same set the ranker boosts from", () => {
    // One definition of whose market this is: the badge and the boost cannot
    // disagree, because there is no second lookup.
    const c = code("src/lib/insider/build.server.ts");
    expect(c).toMatch(/stakes\.created\.has\(Number\(r\.marketId\)\)/);
    expect(c).toMatch(/stakeBoost\(Number\(r\.marketId\), stakes\)/);
  });

  it("is never set inside My Markets", () => {
    // A badge on every row is not a signal, it is a margin.
    expect(code("src/lib/insider/build.server.ts")).toMatch(/if \(!mine && stakes\.created\.has/);
  });

  it("reuses the existing stake boost rather than inventing a second ranking", () => {
    const c = code("src/lib/insider/build.server.ts");
    expect(c).toMatch(/from "@\/domain\/viewer-stake"|viewer-stake/);
    expect(c).not.toMatch(/yourMarketBoost|ownMarketWeight/);
  });
});

describe("the control is the one the People tab already uses", () => {
  it("is a single shared component, not a second dropdown", () => {
    expect(code("src/components/NetworkPanel.tsx")).toMatch(/<DotFilter/);
    expect(code("src/routes/index.tsx")).toMatch(/<DotFilter/);
    // The lifted control kept its accessibility contract.
    const d = code("src/components/DotFilter.tsx");
    expect(d).toMatch(/role="listbox"/);
    expect(d).toMatch(/aria-selected=\{o\.id === value\}/);
    expect(d).toMatch(/aria-haspopup="listbox"/);
  });

  it("sits on the update row rather than adding a line above it", () => {
    // That row already exists and already reserves its height, so the control
    // moves no row — the property rail-stability exists to protect.
    const c = code("src/components/LiveTape.tsx");
    const header = c.slice(c.indexOf('className="mb-4 flex h-[26px]'));
    expect(header.slice(0, 200)).toMatch(/\{leading\}/);
  });

  it("defaults to All Markets and does not remember otherwise", () => {
    // The curated pulse is the one view true for everybody, including the
    // reader who has never opened a question — and most have not.
    const c = code("src/routes/index.tsx");
    expect(c).toMatch(/useState<"all" \| "mine">\("all"\)/);
    expect(c).not.toMatch(/localStorage[^\n]*insider-scope|insiderScope[^\n]*localStorage/);
  });

  it("does not offer 'mine' to somebody with no self", () => {
    // A signed-out visitor cannot have opened a question, so the control would
    // offer one destination that is empty by definition.
    expect(code("src/routes/index.tsx")).toMatch(/leading=\{\s*!wallet \? undefined :/);
  });

  it("says which room is empty, without counting anybody's markets", () => {
    const c = code("src/routes/index.tsx");
    expect(c).toMatch(/Nothing in your markets yet/);
    expect(c).not.toMatch(/0 markets|no markets yet \(0\)/);
  });
});
