/**
 * These exist for one reason: both ways this read can be wrong are SILENT.
 *
 * A whale that crowns nobody is indistinguishable from a market where nobody
 * has qualified yet — which is a legitimate outcome here — so neither mistake
 * would surface as an error. They are pinned instead.
 */
import { describe, expect, it } from "vitest";
import { loadConvictionWhales } from "./conviction-whale.server";

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

type Row = Record<string, unknown>;

/** Minimal stand-in for the query chain this loader uses. */
const fakeSb = (beliefs: Row[], ethUsd: number | null = 2000) =>
  ({
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      for (const m of ["select", "in", "not", "limit", "eq", "order"]) chain[m] = self;
      if (table === "calc_cache") {
        chain.select = () => ({
          eq: () => ({ maybeSingle: async () => ({ data: { value: ethUsd } }) }),
        });
        return chain;
      }
      // The belief query is awaited directly at the end of the chain.
      chain.limit = async () => ({ data: beliefs });
      return chain;
    },
  }) as never;

const holder = (over: Row = {}): Row => ({
  wallet: "0xAAA",
  onchain_id: 1,
  expressed_side: "YES",
  directional_since: ago(30),
  yes_shares: 100,
  no_shares: 0,
  yes_value_usd: null, // the column nothing writes
  no_value_usd: null,
  value_updated_at: null,
  yes_cost: 0.5, // 0.5 ETH of cost basis
  no_cost: 0,
  ...over,
});

describe("loadConvictionWhales", () => {
  it("crowns the largest established holder", async () => {
    const whales = await loadConvictionWhales(
      fakeSb([
        holder({ wallet: "0xSMALL", yes_cost: 0.1 }),
        holder({ wallet: "0xBIG", yes_cost: 2 }),
      ]),
      [1],
    );
    expect(whales.get(1)?.wallet).toBe("0xbig");
  });

  /**
   * THE TRAP THAT SILENCED THE COHORT EMITTER. `yes_value_usd` is never
   * written. Reading it directly makes every holder look like dust, so the
   * whale is never crowned and the market simply appears not to have earned
   * one. Value must fall back to cost.
   */
  it("still values a position when yes_value_usd is null, as it always is", async () => {
    const whales = await loadConvictionWhales(fakeSb([holder({ yes_value_usd: null })]), [1]);
    expect(whales.get(1)).toBeDefined();
  });

  /**
   * THE TRAP THE AUDIT FOUND. Tenure must come from directional_since, which
   * resets on a flip and clears on exit — never from first_backed_at, which
   * would let somebody who left and came back read as a long-term holder.
   */
  it("measures tenure from directional_since, so a fresh re-entry is not established", async () => {
    const whales = await loadConvictionWhales(
      fakeSb([holder({ directional_since: ago(1), yes_cost: 99 })]),
      [1],
    );
    expect(whales.get(1)).toBeUndefined();
  });

  it("leaves a market out entirely when nobody qualifies — never a null entry", async () => {
    const whales = await loadConvictionWhales(fakeSb([holder({ directional_since: ago(3) })]), [1]);
    expect(whales.has(1)).toBe(false);
  });

  it("keeps markets separate, because the seat is per question", async () => {
    const whales = await loadConvictionWhales(
      fakeSb([
        holder({ wallet: "0xONE", onchain_id: 1, yes_cost: 1 }),
        holder({ wallet: "0xTWO", onchain_id: 2, yes_cost: 5 }),
      ]),
      [1, 2],
    );
    expect(whales.get(1)?.wallet).toBe("0xone");
    expect(whales.get(2)?.wallet).toBe("0xtwo");
  });

  it("skips a row whose directional_since is missing rather than treating it as ancient", async () => {
    const whales = await loadConvictionWhales(fakeSb([holder({ directional_since: null })]), [1]);
    expect(whales.has(1)).toBe(false);
  });

  it("asks nothing when there are no markets", async () => {
    expect((await loadConvictionWhales(fakeSb([]), [])).size).toBe(0);
  });
});
