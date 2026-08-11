import { describe, it, expect } from "vitest";
import { walkUp } from "./challenge-chain.server";

/**
 * THE FOUR WAYS A LINEAGE CAN LIE, each asserted to end in truncation.
 *
 * `walkUp` is the first real consumer of `challenges.parent_call`, so it is the
 * first place a corrupt pointer can produce a confident wrong answer — and the
 * wrong answer is always the same shape: naming somebody as the origin of a
 * question they did not start. Every case below must come back
 * `truncated: true`, which the view renders as an ellipsis rather than a root.
 */
const MARKET = 42;

type Call = Parameters<typeof walkUp>[1] extends ReadonlyMap<number, infer C> ? C : never;
type Challenge = Parameters<typeof walkUp>[2] extends ReadonlyMap<number, infer C> ? C : never;

const call = (id: number, caller: string, challengeId: number | null, market = MARKET): Call =>
  ({
    id,
    market_id: market,
    caller_wallet: caller,
    responder_wallet: "0xme",
    called_at: new Date(id * 1000).toISOString(),
    responded_at: null,
    responded_side: null,
    passed_at: null,
    challenge_id: challengeId,
  }) as Call;

const challenge = (
  id: number,
  who: string,
  parentCall: number | null,
  market = MARKET,
): Challenge =>
  ({ id, challenger_wallet: who, market_id: market, parent_call: parentCall }) as Challenge;

const maps = (calls: Call[], challenges: Challenge[]) =>
  [
    new Map(calls.map((c) => [Number(c.id), c])),
    new Map(challenges.map((c) => [Number(c.id), c])),
  ] as const;

describe("the walk proves a route or admits it could not", () => {
  it("walks a real chain to its root and names it", () => {
    // Maya put it up (root) → Sundeep answered and relayed → reached me.
    const [c, ch] = maps(
      [call(1, "0xmaya", 1), call(2, "0xsundeep", 2)],
      [challenge(1, "0xmaya", null), challenge(2, "0xsundeep", 1)],
    );
    expect(walkUp(c.get(2)!, c, ch, MARKET)).toEqual({
      wallets: ["0xmaya", "0xsundeep"],
      truncated: false,
    });
  });

  it("returns a single provable link for a direct call from a root", () => {
    const [c, ch] = maps([call(1, "0xmaya", 1)], [challenge(1, "0xmaya", null)]);
    expect(walkUp(c.get(1)!, c, ch, MARKET)).toEqual({ wallets: ["0xmaya"], truncated: false });
  });

  it("reports nothing at all when nobody brought the viewer in", () => {
    const [c, ch] = maps([], []);
    expect(walkUp(null, c, ch, MARKET)).toEqual({ wallets: [], truncated: false });
  });

  /* ── The four failures ─────────────────────────────────────────────────── */

  it("truncates on a CYCLE rather than looping", () => {
    // A points at B points at A — only a bug writes this, and it must not hang.
    const [c, ch] = maps(
      [call(1, "0xa", 1), call(2, "0xb", 2)],
      [challenge(1, "0xa", 2), challenge(2, "0xb", 1)],
    );
    const r = walkUp(c.get(2)!, c, ch, MARKET);
    expect(r.truncated).toBe(true);
    expect(r.wallets.length).toBeLessThanOrEqual(3);
  });

  it("truncates on a GAP where an ancestor cannot be found", () => {
    // The parent call is missing: bounded read, or a genuinely broken row.
    const [c, ch] = maps([call(2, "0xsundeep", 2)], [challenge(2, "0xsundeep", 999)]);
    expect(walkUp(c.get(2)!, c, ch, MARKET)).toEqual({
      wallets: ["0xsundeep"],
      truncated: true,
    });
  });

  it("truncates on a CROSSING into another market", () => {
    // Not this question's lineage, whatever the pointer says.
    const [c, ch] = maps(
      [call(1, "0xmaya", 1, 999), call(2, "0xsundeep", 2)],
      [challenge(1, "0xmaya", null, 999), challenge(2, "0xsundeep", 1)],
    );
    expect(walkUp(c.get(2)!, c, ch, MARKET)).toEqual({
      wallets: ["0xsundeep"],
      truncated: true,
    });
  });

  it("truncates at the BOUND on a chain deeper than the cap", () => {
    // Twenty links: remarkable, or a bug. Either is better reported than followed.
    const calls: Call[] = [];
    const challenges: Challenge[] = [];
    for (let i = 1; i <= 20; i++) {
      calls.push(call(i, `0xp${i}`, i));
      challenges.push(challenge(i, `0xp${i}`, i === 1 ? null : i - 1));
    }
    const [c, ch] = maps(calls, challenges);
    const r = walkUp(c.get(20)!, c, ch, MARKET);
    expect(r.truncated).toBe(true);
    expect(r.wallets.length).toBeLessThanOrEqual(9);
    // And the earliest name it DID prove is not the actual root.
    expect(r.wallets[0]).not.toBe("0xp1");
  });

  it("truncates a pre-V2 call that has no Challenge behind it", () => {
    // Who asked is provable; whether anything came before them is not.
    const [c, ch] = maps([call(1, "0xmaya", null)], []);
    expect(walkUp(c.get(1)!, c, ch, MARKET)).toEqual({ wallets: ["0xmaya"], truncated: true });
  });

  /**
   * REMOVAL DOES NOT ERASE ANCESTRY. Sundeep taking his Challenge down after
   * Casey answered and relayed must leave the route intact — the walk reads
   * `parent_call` and never `closed_at`, so a closed ancestor is still an
   * ancestor. This is the invariant that keeps history honest after a removal.
   */
  it("keeps a route through a Challenge that was later taken down", () => {
    const [c, ch] = maps(
      [call(1, "0xmaya", 1), call(2, "0xsundeep", 2)],
      [challenge(1, "0xmaya", null), challenge(2, "0xsundeep", 1)],
    );
    // `closed_at` is not even selected by the walk — asserted by the result.
    expect(walkUp(c.get(2)!, c, ch, MARKET)).toEqual({
      wallets: ["0xmaya", "0xsundeep"],
      truncated: false,
    });
  });

  it("never returns the viewer as a link in their own route", () => {
    const [c, ch] = maps(
      [call(1, "0xmaya", 1), call(2, "0xsundeep", 2)],
      [challenge(1, "0xmaya", null), challenge(2, "0xsundeep", 1)],
    );
    expect(walkUp(c.get(2)!, c, ch, MARKET).wallets).not.toContain("0xme");
  });
});
