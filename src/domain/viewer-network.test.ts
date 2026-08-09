import { describe, expect, it } from "vitest";
import { viewerNetwork, type ViewerDnaRow } from "./viewer-network";

const rel = (wallet: string) => ({
  wallet,
  score: 0.9,
  shared: 12,
  lastAt: "2026-01-01T00:00:00Z",
});

const dna = (over: Partial<ViewerDnaRow> = {}): ViewerDnaRow => ({
  twin_matches: [],
  tribe_matches: [],
  opp_matches: [],
  inverse_matches: [],
  ...over,
});

describe("viewerNetwork", () => {
  it("labels each wallet by the bucket it came from", () => {
    const n = viewerNetwork(
      dna({ twin_matches: [rel("0xAAA")], inverse_matches: [rel("0xBBB")] }),
      false,
    );
    expect(n.labelByWallet.get("0xaaa")).toBe("twin");
    expect(n.labelByWallet.get("0xbbb")).toBe("inverse");
  });

  it("lower-cases wallets, so a checksummed address still matches a row's actor", () => {
    const n = viewerNetwork(dna({ tribe_matches: [rel("0xAbCdEf")] }), false);
    expect([...n.labelByWallet.keys()]).toEqual(["0xabcdef"]);
  });

  it("drops entries with no wallet rather than keying a label on undefined", () => {
    const n = viewerNetwork(dna({ twin_matches: [{ score: 1 }, rel("0xAAA")] }), false);
    expect(n.labelByWallet.size).toBe(1);
  });

  it("is empty when nobody is signed in or nothing is cached", () => {
    const n = viewerNetwork(null, false);
    expect(n.labelByWallet.size).toBe(0);
    expect(n.relByWallet.size).toBe(0);
    expect(n.moments).toEqual([]);
  });

  it("withholds discovery moments inside a market panel", () => {
    // A panel is about that market, not about the reader's network.
    const scoped = viewerNetwork(dna({ twin_matches: [rel("0xAAA")] }), true);
    expect(scoped.moments).toEqual([]);
  });
});

/**
 * THE INVARIANT THE CACHE BOUNDARY WILL REST ON.
 *
 * Personalization is only safe to run over a shared factual set if one reader's
 * network can never reach another's. These assert that directly, at the one
 * function that turns a viewer into relationship labels.
 */
describe("one reader's network never reaches another's", () => {
  const alice = dna({ twin_matches: [rel("0xAAA")], tribe_matches: [rel("0xSHARED")] });
  const bob = dna({ inverse_matches: [rel("0xBBB")], opp_matches: [rel("0xSHARED")] });

  it("gives two readers different labels for the same wallet", () => {
    const a = viewerNetwork(alice, false);
    const b = viewerNetwork(bob, false);
    expect(a.labelByWallet.get("0xshared")).toBe("tribe");
    expect(b.labelByWallet.get("0xshared")).toBe("opp");
  });

  it("leaks nothing from one reader into the other", () => {
    const a = viewerNetwork(alice, false);
    const b = viewerNetwork(bob, false);
    expect(a.labelByWallet.has("0xbbb")).toBe(false);
    expect(b.labelByWallet.has("0xaaa")).toBe(false);
  });

  it("hands back fresh Maps, so a later mutation cannot travel between readers", () => {
    const a = viewerNetwork(alice, false);
    const b = viewerNetwork(alice, false);
    expect(a.labelByWallet).not.toBe(b.labelByWallet);
    a.labelByWallet.set("0xINJECTED", "twin");
    expect(b.labelByWallet.has("0xINJECTED")).toBe(false);
  });

  it("does not mutate the row it was given, so a shared source stays clean", () => {
    const source = dna({ twin_matches: [rel("0xAAA")] });
    const before = JSON.stringify(source);
    viewerNetwork(source, false);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("is deterministic — the same reader twice yields the same labels", () => {
    const first = viewerNetwork(alice, false);
    const second = viewerNetwork(alice, false);
    expect([...second.labelByWallet]).toEqual([...first.labelByWallet]);
  });
});
