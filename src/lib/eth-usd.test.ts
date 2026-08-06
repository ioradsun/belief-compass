import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readEthUsd, readEthUsdReading } from "./eth-usd.server";

/** A minimal PostgREST-shaped stub: only `.from(...).select().eq().maybeSingle()`. */
const sbReturning = (data: unknown) =>
  ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data }) }) }),
    }),
  }) as never;

const sbThrowing = () =>
  ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            throw new Error("permission denied for table calc_cache");
          },
        }),
      }),
    }),
  }) as never;

describe("readEthUsd", () => {
  it("returns the rate when there is one", async () => {
    expect(
      await readEthUsd(sbReturning({ value: 3421.18, updated_at: "2026-08-06T00:00:00Z" })),
    ).toBe(3421.18);
  });

  it("returns NULL, not zero, when the read is blocked", async () => {
    // The production incident this module exists for: calc_cache shipped with
    // RLS on and no anon policy, so the read returned 200 with zero rows for
    // months. `|| 0` turned that into "every position is worth $0.00".
    expect(await readEthUsd(sbReturning(null))).toBeNull();
  });

  it("returns null when the read throws rather than taking the screen down", async () => {
    expect(await readEthUsd(sbThrowing())).toBeNull();
  });

  it("treats a stored zero, negative, or non-numeric value as no rate", async () => {
    // A rate of zero is not a cheap ETH — it is a broken calibration, and using
    // it prices the whole app at nothing.
    for (const value of [0, -1, null, undefined, "abc", Number.NaN]) {
      expect(await readEthUsd(sbReturning({ value }))).toBeNull();
    }
  });
});

describe("readEthUsdReading", () => {
  it("distinguishes a blocked read from an unset value", async () => {
    // Worth separating: refreshing the calibration fixes "unset" and does
    // nothing at all for "blocked", which is a grant.
    expect((await readEthUsdReading(sbReturning(null))).reason).toBe("blocked");
    expect((await readEthUsdReading(sbReturning({ value: 0 }))).reason).toBe("unset");
    expect((await readEthUsdReading(sbReturning({ value: 3000 }))).reason).toBe("ok");
  });

  it("carries the calibration timestamp for staleness display", async () => {
    const r = await readEthUsdReading(
      sbReturning({ value: 3000, updated_at: "2026-08-06T12:00:00Z" }),
    );
    expect(r.updatedAt).toBe("2026-08-06T12:00:00Z");
  });
});

/**
 * ONE READER. The rate had eight, four of them byte-identical, every one
 * returning 0 when it could not price. This is what stops a ninth appearing.
 */
describe("nothing reads the rate on its own any more", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("has exactly one module querying calc_cache.eth_usd", () => {
    const callers = [
      "src/lib/share.functions.ts",
      "src/lib/evidence.functions.ts",
      "src/lib/conviction-dashboard.server.ts",
      "src/lib/conviction-cohort-emit.server.ts",
      "src/lib/ecosystem-value.server.ts",
      "src/lib/markets.functions.ts",
    ].filter((f) => /eq\(\s*"key",\s*"eth_usd"\s*\)/.test(strip(read(f))));
    // markets.functions.ts keeps ONE: `getEthUsd`, the client-facing server fn
    // that the DisplayUnit context polls. It already returned null correctly.
    expect(callers).toEqual(["src/lib/markets.functions.ts"]);
  });

  it("and that survivor is the client-facing reader, which also never returns zero", () => {
    const code = strip(read("src/lib/markets.functions.ts"));
    expect(code).toMatch(/rate: rate > 0 \? rate : null/);
  });

  it("keeps the confident-zero fallback out of the shared reader", () => {
    const code = strip(read("src/lib/eth-usd.server.ts"));
    expect(code).not.toMatch(/\?\?\s*0\s*\)\s*\|\|\s*0/);
    expect(code).not.toMatch(/:\s*number\s*>/);
  });
});
