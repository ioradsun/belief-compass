import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { rowsOf, rowOf } from "./supabase-read";

const src = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

afterEach(() => vi.restoreAllMocks());

describe("a failed read is never an empty answer", () => {
  it("returns the rows when the read worked", () => {
    expect(rowsOf({ data: [1, 2, 3], error: null }, "x")).toEqual([1, 2, 3]);
  });

  it("returns an empty list only when the database said so", () => {
    // The genuine empty. This is the case `?? []` gets RIGHT, and the reason the
    // wrong version is so hard to see: it is correct most of the time.
    expect(rowsOf({ data: [], error: null }, "x")).toEqual([]);
    expect(rowsOf({ data: null, error: null }, "x")).toEqual([]);
  });

  it("throws rather than inventing nothing", () => {
    expect(() =>
      rowsOf({ data: null, error: { message: "permission denied" } }, "the ledger"),
    ).toThrow(/the ledger failed: permission denied/);
  });

  it("throws even when the driver also handed back rows", () => {
    // A partial result is not a result. Returning `data` here would be the same
    // bug wearing a hat: a truncated list presented as the whole truth.
    expect(() => rowsOf({ data: [1], error: { message: "timeout" } }, "x")).toThrow();
  });

  it("logs as well as throwing, because a caller can swallow one and not the other", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => rowsOf({ data: null, error: { message: "boom", code: "42501" } }, "x")).toThrow();
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("x failed"),
      expect.objectContaining({ code: "42501" }),
    );
  });

  it("keeps 'no such row' apart from 'could not ask'", () => {
    // `maybeSingle()` returns { data: null, error: null } for a genuine miss, so
    // the two are distinguishable — which is exactly what `readViewerDnaCache`
    // was losing when it read a blocked query as a cold cache.
    expect(rowOf({ data: null, error: null }, "x")).toBeNull();
    expect(() => rowOf({ data: null, error: { message: "nope" } }, "x")).toThrow();
  });
});

/**
 * THE RULE, HELD IN PLACE.
 *
 * Not "no module may ever tolerate a failure" — enrichment paths should, and
 * `serviceClientOrNull` exists for them. The rule is narrower and absolute: a
 * surface whose empty state is a CLAIM about a person must not be able to reach
 * that state by accident.
 */
describe("surfaces whose empty state is a claim read honestly", () => {
  const claims: [string, string[]][] = [
    // Your own money, your own history. Zero here is a sentence about you.
    [
      "src/lib/conviction-dashboard.server.ts",
      [
        "this wallet's positions",
        "the markets this wallet created",
        "this wallet's own buys",
        "market state for this wallet's positions",
      ],
    ],
    // "Nobody came from your link" is the whole output of this function.
    ["src/lib/share.functions.ts", ["this wallet's share codes", "visits to this wallet's shares"]],
    // What the House has seen you do — its entire basis for claiming to know you.
    ["src/lib/house.server.ts", ["this wallet's answer history"]],
  ];

  for (const [file, phrases] of claims)
    it(`${file} binds the error on its load-bearing reads`, () => {
      const c = src(file);
      expect(c).toMatch(/from "@\/lib\/supabase-read"/);
      for (const p of phrases) expect(c, p).toContain(p);
    });

  it("still tolerates failure where empty costs detail and nothing else", () => {
    // Display-name overrides. Losing them shows the deterministic alias, which is
    // a real name for that wallet — nothing false is stated. Turning this into a
    // throw would trade "slightly less colour" for "the page 500s", which is the
    // worse deal and the reason this rule is not a blanket ban.
    const c = src("src/lib/profiles.server.ts");
    expect(c).toMatch(/profile_overrides/);
    expect(c).toMatch(/data \?\? \[\]/);
  });
});
