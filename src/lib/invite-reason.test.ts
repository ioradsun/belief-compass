import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A REASON IS MANDATORY AT THE PRODUCT LEVEL, EVEN THOUGH THE COLUMN IS NULL-ABLE.
 *
 * `market_invites.reason` is nullable on purpose: the table shipped before the
 * column existed, and back-filling rows with invented copy would put words in
 * people's mouths that they never wrote. So old rows keep a null and the
 * PRODUCT refuses to surface them — an invitation that cannot truthfully say
 * "why you" simply does not appear in For You.
 *
 * That leaves a seam, and this test is what holds it shut. The gap between "the
 * database permits null" and "the product never shows one" is exactly the kind
 * of rule that erodes: the next person to see a blank row will reach for a
 * friendly default, and a single `?? "You were invited"` would silently readmit
 * every unjustifiable invitation ever written. It would also look like a
 * kindness while doing it, which is why a comment is not enough.
 *
 * THE PROPERTY, stated over source rather than behaviour: nothing on the
 * invitation path may substitute a non-empty default for a missing reason.
 * Coercing null to "" is fine and in fact required — an empty string still
 * fails the gate downstream. Substituting prose is the bug.
 *
 * Precedent: wallet-authorship.test.ts guards "a rejected proof of authorship
 * is never swallowed" the same way, and eth-usd.test.ts guards "exactly one
 * module reads calc_cache.eth_usd".
 */

const SRC = new URL("../", import.meta.url).pathname;

/** Every file that touches an invitation's reason on its way to a reader. */
const PATH = [
  "domain/for-you.ts",
  "domain/launch-audience.ts",
  "lib/launch.server.ts",
  "lib/launch.functions.ts",
  "components/ForYouShelf.tsx",
  "components/LaunchRail.tsx",
];

/**
 * `reason` (or `.reason`) followed by `??` / `||` and a NON-EMPTY string
 * literal. Deliberately crude: a false positive here is a prompt to look, and
 * the cost of missing the real thing is the whole rule.
 */
const DEFAULTED = /\breason\w*\s*(?:\?\?|\|\|)\s*(['"`])(?!\1)/;

describe("an invitation that cannot say why THIS person is never shown", () => {
  const files = PATH.map((p) => ({ path: p, src: readFileSync(join(SRC, p), "utf8") }));

  it("reads the files it claims to guard", () => {
    // A guard that silently checks nothing is worse than no guard.
    for (const f of files) expect(f.src.length, f.path).toBeGreaterThan(100);
  });

  it("never substitutes a default reason anywhere on the path", () => {
    const offenders = files
      .filter((f) => DEFAULTED.test(f.src))
      .map((f) => `${f.path}: ${DEFAULTED.exec(f.src)?.[0]}`);
    expect(offenders).toEqual([]);
  });

  it("still allows coercing null to empty, which fails the gate honestly", () => {
    // The distinction the regex above is drawn around, asserted directly so a
    // future reader can see it is intentional rather than an oversight.
    expect(DEFAULTED.test('reason: String(r.reason ?? "")')).toBe(false);
    expect(DEFAULTED.test('reason: r.reason ?? "You were invited"')).toBe(true);
  });

  it("filters unreasoned rows at the read, not just at the write", () => {
    // Both ends matter. The write path can only refuse NEW rows; rows that
    // predate the column are already there, and the shelf is what a person
    // actually sees.
    const server = files.find((f) => f.path === "lib/launch.server.ts")!.src;
    expect(server).toMatch(/\.filter\(\(r\) => !!r\.reason\?\.trim\(\)\)/);
  });

  it("requires a non-empty reason on the wire, so a client cannot omit one", () => {
    const fns = files.find((f) => f.path === "lib/launch.functions.ts")!.src;
    expect(fns).toMatch(/reason:\s*z\.string\(\)\.min\(1\)/);
  });
});

/**
 * `side` IS DELIBERATELY UNSET BY THE INVITE FLOW.
 *
 * The column exists and is useful, but recruitment invites someone INTO a
 * market — it does not tell them which side to take. An invitation that arrived
 * pre-loaded with the sender's answer is not a recruitment, it is a
 * solicitation, and it would quietly turn the For You shelf into a place where
 * people are told what to think by whoever got there first.
 *
 * Reserved for a real "challenge this side" interaction, where naming a side is
 * the entire point and the recipient knows it. Until that exists, the initial
 * invite must not be overloaded with it — which is easy to do by accident,
 * since the column is right there in every insert this file makes.
 */
describe("recruitment invites into a market, never onto a side", () => {
  it("never writes `side` on an invitation", () => {
    const server = readFileSync(join(SRC, "lib/launch.server.ts"), "utf8");
    // Method-agnostic: this write has already been an upsert and an insert, and
    // the rule is about what it SETS, not how it is spelled.
    const write = /\.from\("market_invites"\)\s*\.(?:insert|upsert)\(([\s\S]{0,1200}?)\n\s*\);/.exec(
      server,
    );
    expect(write, "could not find the market_invites write").not.toBeNull();
    // Strip comments first — the paragraph explaining WHY side is unset
    // naturally contains the word, and flagging its own rationale would make
    // the guard impossible to document.
    const code = write![1].replace(/\/\/[^\n]*/g, "");
    expect(code).not.toMatch(/(^|[^_\w])side\s*:/);
  });
});
