import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VALUE, positionValueUsd } from "@/domain/position-value";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
/**
 * Comments stripped before asserting. These files EXPLAIN what was removed, and
 * an assertion that cannot tell prose from code fails on its own rationale —
 * the same trap `network-freshness.test.ts` documents.
 */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

const MARKETS = code("src/lib/markets.functions.ts");
const POV = code("src/lib/pov.server.ts");

/**
 * ONE AUTHORITY ON WHAT A POSITION IS WORTH — as executable notes.
 *
 * `getWallet` used to call pov.co on every request and let it override both the
 * marked value and the SHARE COUNT. That made sense when
 * `wallet_beliefs.yes_value_usd` had six readers and no writer; `belief-rollup`
 * now writes it every minute from `market_state`, so the external call became a
 * second authority for a number the rest of the app already agrees on.
 *
 * The drift check that override was accidentally performing is not lost — it
 * lives in `position-reconcile` (nightly, against canonical chain events) and in
 * `npm run verify:reducer` (on demand, against POV). Both REPORT or REPAIR;
 * neither conceals.
 */
describe("the portfolio is valued from our own numbers", () => {
  it("does not call pov.co on the read path", () => {
    // The regression: a request-time external dependency on a screen that shows
    // a person their money.
    expect(MARKETS).not.toMatch(/fetchPovPositions/);
  });

  it("keeps the POV positions fetcher deleted rather than merely unused", () => {
    // An exported helper with no callers is an invitation. Identity lookups
    // (fetchPovUser) are a different concern and stay.
    expect(POV).not.toMatch(/fetchPovPositions/);
    expect(POV).toMatch(/export async function fetchPovUser/);
  });

  it("still has the drift check, in the two places it belongs", () => {
    // Nightly, against canonical chain events — a stronger authority than POV,
    // and it repairs rather than papering over.
    const reconcile = read("src/lib/positions/reconcile.server.ts");
    expect(reconcile).toMatch(/reducerStateHash/);
    expect(reconcile).toMatch(/rebuildPosition/);
    // And a POV comparison on demand, as a diagnostic.
    expect(read("package.json")).toMatch(/verify:reducer/);
  });

  it("uses the one staleness threshold rather than a second local copy", () => {
    // getWallet carried its own 60-minute constant while the canonical rule was
    // 30 — the looser of the two, so this screen called a value trustworthy for
    // half an hour after the shared rule had given up on it.
    expect(MARKETS).toMatch(/VALUE\.staleAfterMs/);
    expect(MARKETS).not.toMatch(/const STALE_MS/);
  });

  it("reports staleness honestly instead of letting a second opinion mute it", () => {
    // Was `pov?.yes == null && stale` — any POV answer suppressed the flag
    // outright, so a stale mark could render as fresh.
    expect(MARKETS).not.toMatch(/yes_value_stale:\s*pov/);
  });
});

describe("the valuation fallback chain still holds", () => {
  it("prefers a fresh marked value and says it is current", () => {
    const now = Date.parse("2026-08-06T12:00:00Z");
    const v = positionValueUsd({
      valueUsd: 42,
      valueUpdatedAt: new Date(now - 60_000).toISOString(),
      nowMs: now,
    });
    expect(v).toEqual({ usd: 42, source: "marked", freshness: "current" });
  });

  it("still renders an old mark, labelled stale rather than hidden", () => {
    // The number is the last true thing we knew; suppressing it would be worse
    // than showing it with its age.
    const now = Date.parse("2026-08-06T12:00:00Z");
    const v = positionValueUsd({
      valueUsd: 42,
      valueUpdatedAt: new Date(now - VALUE.staleAfterMs - 1).toISOString(),
      nowMs: now,
    });
    expect(v.usd).toBe(42);
    expect(v.freshness).toBe("stale");
  });

  it("falls back to cost basis when nothing has ever marked the position", () => {
    // This is what now catches a wallet whose markets the rollup could not
    // price — the case POV used to cover, handled without an external call.
    const v = positionValueUsd({ valueUsd: null, costEth: 0.01, ethUsd: 3000 });
    expect(v).toEqual({ usd: 30, source: "cost", freshness: "fallback" });
  });

  it("says unknown rather than zero when it cannot know", () => {
    // A confident zero is the exact bug that emptied the cohorts.
    expect(positionValueUsd({ valueUsd: null, costEth: null, ethUsd: null })).toEqual({
      usd: 0,
      source: "unknown",
      freshness: "unknown",
    });
  });
});

/**
 * THE CLIENT HALF OF THE SAME RULE.
 *
 * `domain/money#convertMoney` is documented as the single place a number crosses
 * between units, and it returns null when it cannot — "callers render '—' rather
 * than a fabricated figure." Several components bypassed it with their own
 * multiplication and a `: 0` or `|| 0` fallback, which is the same confident
 * zero the server had (see lib/eth-usd.server).
 */
describe("no surface converts ETH to USD with a fabricated rate", () => {
  const surfaces = [
    "src/components/CaseFile.tsx",
    "src/components/MarketVitality.tsx",
    "src/components/ConvictionDashboard.tsx",
  ];

  it("does not fall back to a zero rate", () => {
    const offenders = surfaces.filter((f) => /\*\s*\(ethUsd\s*\|\|\s*0\)/.test(code(f)));
    expect(offenders).toEqual([]);
  });

  it("does not substitute zero for a missing rate before multiplying", () => {
    // `eth * (ethUsd > 0 ? ethUsd : 0)` reads as a guard and behaves as a lie.
    const offenders = surfaces.filter((f) => /ethUsd\s*>\s*0\s*\?\s*ethUsd\s*:\s*0/.test(code(f)));
    expect(offenders).toEqual([]);
  });

  it("routes the conversions that remain through the canonical converter", () => {
    for (const f of ["src/components/CaseFile.tsx", "src/components/MarketVitality.tsx"]) {
      expect(code(f), f).toMatch(/convertMoney/);
    }
  });
});

/**
 * ONE VALUATION ORDER. `MyConvictions` ranked positions its own way inline —
 * fresh mark, else shares x price — with neither the stale-mark nor the
 * cost-basis rank, and a price chain ending `?? 0`.
 */
describe("the Positions list does not rank worth on its own", () => {
  const MY = code("src/components/MyConvictions.tsx");

  it("values through the canonical module", () => {
    expect(MY).toMatch(/positionValueUsd/);
  });

  it("no longer ends its price chain at a fabricated zero", () => {
    // `?? 0` on the price made `shares * price` zero for an unpriced market.
    expect(MY).not.toMatch(/no_price_usd\)\s*\?\?\s*\n?\s*0,/);
  });

  it("filters on OWNERSHIP, not on whether we could price it", () => {
    // `!(value > 0)` conflated "you do not hold this side" with "we could not
    // price what you hold", and removed real holdings from the holder's list.
    expect(MY).not.toMatch(/if \(!\(value > 0\)\) return null/);
    expect(MY).toMatch(/if \(!\(shares > 0\)\) return null/);
  });

  /**
   * THE HEADLINE IS THE CARDS, SUMMED. The summary read the market's window
   * price change while the cards read cost-basis P&L, so a rail full of real
   * returns sat under a blank "—" whenever no window change was on file.
   */
  it("sums the same P&L its cards print", () => {
    expect(MY).toMatch(/const marked = built\.filter\(\(p\) => p\.gainUsd != null\)/);
    expect(MY).toMatch(/markedGain/);
    expect(MY).toMatch(/markedBasis/);
    // The window move survives only as the no-basis-anywhere fallback.
    expect(MY).not.toMatch(/lifetime && fullBasis/);
  });
});

/**
 * The Full P&L page and the Positions rail are one wallet's money told twice.
 * The dashboard used to read neither shares nor the live price, so its holdings
 * could only reach the COST rank while the rail marked the same position live.
 */
describe("the dashboard marks positions the way the rail does", () => {
  const DASH = code("src/lib/conviction-dashboard.server.ts");

  it("selects the fields a live mark needs", () => {
    for (const col of ["yes_shares", "no_shares", "value_updated_at"])
      expect(DASH, col).toContain(col);
  });

  it("hands shares and price to the canonical valuation", () => {
    expect(DASH).toMatch(/shares: b\.yes_shares/);
    expect(DASH).toMatch(/priceUsd: price\?\.yes/);
  });

  it("accepts a live mark as a measurement, not only a written one", () => {
    expect(DASH).toMatch(/isMeasured\(yes\) \|\| isMeasured\(no\)/);
    expect(DASH).not.toMatch(/yes\.source === "marked" \|\| no\.source === "marked"/);
  });

  it("computes gain over the positions it could mark", () => {
    expect(DASH).toMatch(/gainUsd: markedWorthUsd - markedCostUsd/);
  });
});

/**
 * The unit crossing has ONE home. `domain/money` declares itself "the SINGLE
 * place a number crosses between units"; wei→ETH is exactly that, and it was
 * declared in three other files under two names.
 */
describe("wei conversion is not redeclared", () => {
  it("has exactly one definition", () => {
    const owners = [
      "src/domain/money.ts",
      "src/domain/order.ts",
      "src/domain/ecosystem-share.ts",
      "src/lib/ecosystem-value.server.ts",
      "src/components/ConvictionDashboard.tsx",
    ].filter((f) => /(const|function) weiToEth/.test(code(f)));
    expect(owners).toEqual(["src/domain/money.ts"]);
  });

  it("is not bypassed with a literal 1e18 in the money modules", () => {
    for (const f of ["src/domain/order.ts", "src/domain/ecosystem-share.ts"]) {
      expect(code(f), f).not.toMatch(/\/ 1e18/);
    }
  });
});
