import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * AUTHORSHIP IS NEVER SWALLOWED.
 *
 * THE MODULE THAT MOTIVATED THIS IS GONE; THE RULE IS NOT. `welcomes.functions.ts`
 * was deleted along with Say Hi when Challenge replaced it, and the obvious move
 * was to delete this file with it. That would have been backwards. The bug was
 * never about welcomes — it was about a SHAPE that any server function can grow,
 * and the scan below is what makes it a rule rather than one module's history.
 * Losing the guard because its first offender was refactored away is how a class
 * of bug comes back.
 *
 * The original, kept because it is the clearest statement of the failure:
 * `welcomes.functions.ts` verified the wallet session and then, on any failure,
 * carried on with the wallet the CALLER claimed:
 *
 *     try {
 *       return await assertWalletOwnership(wallet, session);
 *     } catch {
 *       // stale token — the gesture is free, fall through to the claimed wallet
 *     }
 *     return wallet.toLowerCase();
 *
 * The reasoning was that saying hi moves no money. That is true and beside the
 * point: a welcome puts your name in someone else's interface, and server
 * functions are public, so anyone could post "your Twin said hi" from any wallet
 * to any wallet.
 *
 * This is a SOURCE guard rather than a behavioural one on purpose. The failure
 * is a shape — a verification whose rejection goes nowhere — and it can reappear
 * in any server function, not just the one that had it. Checking the property
 * across every file is what makes it a rule instead of a fix. (Precedent:
 * eth-usd.test.ts guards "exactly one module reads calc_cache.eth_usd" the same
 * way.)
 *
 * The rule is about the FAILURE, not the mechanism: verify however you like, but
 * a rejected proof of authorship must never resolve to a caller-supplied wallet.
 */

const LIB = new URL("./", import.meta.url).pathname;

function serverFunctionFiles(): string[] {
  return readdirSync(LIB)
    .filter((f) => f.endsWith(".functions.ts") || f.endsWith(".server.ts"))
    .map((f) => join(LIB, f));
}

/**
 * Every `catch` body in the file, paired with the `try` block it belongs to.
 * Deliberately crude: it only has to be good enough to find a swallowed
 * assertion, and a false positive here is a prompt to look, not a wrong answer.
 */
function tryCatchPairs(src: string): { tried: string; caught: string; after: string }[] {
  const out: { tried: string; caught: string; after: string }[] = [];
  const re = /try\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    // Walk braces from the `try {` to its matching close.
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    const tried = src.slice(m.index, i + 1);
    const rest = src.slice(i + 1);
    const c = /^\s*catch\s*(\([^)]*\))?\s*\{/.exec(rest);
    if (!c) continue;
    let d = 0;
    let j = c[0].length - 1;
    for (; j < rest.length; j++) {
      if (rest[j] === "{") d++;
      else if (rest[j] === "}") {
        d--;
        if (d === 0) break;
      }
    }
    // The old hole put the fallback AFTER the catch, not inside it, so the
    // trailing statements are part of what has to be checked.
    out.push({ tried, caught: rest.slice(0, j + 1), after: rest.slice(j + 1, j + 300) });
  }
  return out;
}

/** Anything that establishes who is acting. Add to this list, never remove. */
const PROOF = /assertWalletOwnership|walletFromToken|assertIngestBearer/;

describe("a rejected proof of authorship is never swallowed", () => {
  const files = serverFunctionFiles();

  it("finds server modules to check at all", () => {
    // A guard that silently checks nothing is worse than no guard.
    expect(files.length).toBeGreaterThan(5);
  });

  it("never continues past a failed ownership check", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      if (!PROOF.test(src)) continue;
      for (const { tried, caught, after } of tryCatchPairs(src)) {
        if (!PROOF.test(tried)) continue;
        // THE PROPERTY: a failed proof must not PRODUCE AN IDENTITY. Rethrowing
        // is fine. Returning a shape that grants nothing — null, an empty
        // result, an object of nulls — is fine, because the caller still has no
        // wallet to act as. Handing back the wallet the caller asked for is the
        // bug, whether that happens inside the catch or just after it.
        const rethrows = /\bthrow\b/.test(caught);
        const yieldsWallet = /return[^;}]*\bwallet\b/.test(caught + after);
        if (!rethrows && yieldsWallet) {
          offenders.push(
            `${file.split("/").pop()}: ${(caught + after).replace(/\s+/g, " ").slice(0, 110)}`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no module anywhere reintroduces the exact fallback that shipped the hole", () => {
    // The specific line, in any spacing, across every server module — not just
    // the one that had it. `welcomes.functions.ts` is deleted; this outlives it.
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      expect(
        /catch\s*\{[^}]*\}\s*\}?\s*return\s+wallet\.toLowerCase\(\)/.test(src),
        file.split("/").pop(),
      ).toBe(false);
    }
  });
});
