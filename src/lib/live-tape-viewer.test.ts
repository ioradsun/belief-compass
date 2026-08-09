/**
 * THE FIRST TESTS THAT RUN buildTape.
 *
 * This path had no coverage at all: it reached for a Supabase client and seven
 * queries inline, so there was no way to run it twice with two readers and
 * compare. Every guarantee about personalization was therefore an argument
 * rather than an assertion — including the one that matters most, that a
 * signed-in reader can never see another reader's relationships.
 *
 * With the loaders injectable, the same factual source can be handed to two
 * viewers and the results compared directly. That is the net the remaining work
 * needs: removing row mutation is an all-or-nothing change across four passes,
 * and until now nothing would have caught a slip.
 */
import { describe, expect, it } from "vitest";
import { buildTape } from "./insider/build.server";
import type { TapeDeps } from "@/lib/insider/source.server";

const MARKET = 7;
const ACTOR = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

/** One real trade, in the shape the events query returns. */
const tradeRow = () => ({
  source_key: "chain:trade:1",
  kind: "trade",
  market_id: String(MARKET),
  side: "YES",
  action: "BUY",
  amount_eth: 1e18,
  wallet: ACTOR,
  occurred_at: new Date(Date.now() - 60_000).toISOString(),
  block_number: 100,
  log_index: 1,
});

const source = () => ({
  rows: [tradeRow()] as Record<string, unknown>[],
  marketIds: [MARKET],
  titleById: new Map([[MARKET, "Is this a question?"]]),
  creatorByMarket: new Map<number, string>(),
  momentumById: new Map(),
  ethUsd: 2000,
  error: null as string | null,
});

/** A DNA cache row placing the actor in one bucket. */
const dnaWith = (bucket: "twin_matches" | "opp_matches") => ({
  twin_matches: [],
  tribe_matches: [],
  opp_matches: [],
  inverse_matches: [],
  [bucket]: [{ wallet: ACTOR, score: 0.95, shared: 20, lastAt: "2026-01-01T00:00:00Z" }],
});

const deps = (over: Partial<TapeDeps> = {}): TapeDeps =>
  ({
    client: () => ({}) as never,
    loadTapeSource: async () => source(),
    loadBelieverFaces: async () => new Map(),
    loadActorBeliefs: async () => new Map(),
    loadViewerDna: async () => null,
    loadViewerHoldings: async () => new Set<number>(),
    resolveProfiles: async () => new Map(),
    ...over,
  }) as TapeDeps;

const faceOf = (res: { rows: Array<{ face?: { relationship?: unknown } | null }> }) =>
  res.rows.find((r) => r.face)?.face?.relationship ?? null;

describe("buildTape builds from the injected source", () => {
  it("produces rows from one trade, without touching a database", async () => {
    const res = await buildTape({ limit: 20 }, deps());
    expect(res.error).toBeNull();
    expect(res.rows.length).toBeGreaterThan(0);
  });

  it("reports a source failure instead of an empty feed", async () => {
    const res = await buildTape(
      { limit: 20 },
      deps({ loadTapeSource: async () => ({ ...source(), rows: [], error: "boom" }) }),
    );
    expect(res.error).toBe("boom");
    expect(res.rows).toEqual([]);
  });

  it("is anonymous when nobody is signed in", async () => {
    const res = await buildTape({ limit: 20 }, deps());
    expect(faceOf(res)).toBeNull();
  });
});

describe("one reader's personalization never reaches another's", () => {
  const forViewer = (bucket: "twin_matches" | "opp_matches") =>
    buildTape(
      { limit: 20, wallet: "0xreader" },
      deps({ loadViewerDna: async () => dnaWith(bucket) as never }),
    );

  it("tags the same actor differently for two readers of the same facts", async () => {
    expect(faceOf(await forViewer("twin_matches"))).toBe("twin");
    expect(faceOf(await forViewer("opp_matches"))).toBe("opp");
  });

  it("does not leak a relationship into a reader who has none", async () => {
    await forViewer("twin_matches");
    // A later anonymous build must be untouched by the signed-in one before it.
    expect(faceOf(await buildTape({ limit: 20 }, deps()))).toBeNull();
  });

  it("is deterministic — the same reader twice yields the same tag", async () => {
    expect(faceOf(await forViewer("twin_matches"))).toBe(faceOf(await forViewer("twin_matches")));
  });

  it("leaves the factual source unchanged, whoever reads it", async () => {
    const shared = source();
    const before = JSON.stringify(shared.rows);
    const d = (bucket: "twin_matches" | "opp_matches") =>
      deps({
        loadTapeSource: async () => shared,
        loadViewerDna: async () => dnaWith(bucket) as never,
      });
    await buildTape({ limit: 20, wallet: "0xa" }, d("twin_matches"));
    await buildTape({ limit: 20, wallet: "0xb" }, d("opp_matches"));
    // THE PROPERTY THE CACHE BOUNDARY WILL REST ON: composition may decorate
    // rows for a reader, but it must never write back into the shared facts.
    expect(JSON.stringify(shared.rows)).toBe(before);
    expect(shared.titleById.get(MARKET)).toBe("Is this a question?");
  });
});
