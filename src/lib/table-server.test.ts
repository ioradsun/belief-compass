import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const code = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

/**
 * "3 of 8 showed up" is a permanent claim about eight real people. Everything
 * below is a way that sentence could become false, asserted closed.
 */
describe("a Challenge cannot claim what the server did not see", () => {
  it("proves a position before stamping anybody as having shown up", () => {
    // `answerCalls` is an unsigned POST carrying { wallet, marketId }, and it used
    // to stamp on the client's word. Survivable while Showing Up was a quiet
    // relationship fact; not survivable once a creator reads a count, because
    // anyone could have made any of it true with a curl command.
    const c = code("src/lib/challenge.server.ts");
    expect(c).toMatch(/async function tookAPosition/);
    // The gate now also RETURNS the side, so the call is destructured rather than
    // used as a bare predicate. The proof itself is unchanged: the row's
    // existence is what proves the position, and the side is only carried along
    // for the card. Nothing may make the side a condition of being stamped.
    expect(c).toMatch(/const proof = await tookAPosition\(sb, wallet, marketId\)/);
    expect(c).toMatch(/if \(!proof\.proved\)/);
    expect(c).not.toMatch(/if \(!proof\.side\) return|proof\.side &&[^\n]*pending: true/);
    // Both proofs are server-read canonical facts, never the request body.
    expect(c).toMatch(/from\("wallet_beliefs"\)[\s\S]*?stance_side/);
    expect(c).toMatch(/is_canonical", true\)/);
  });

  it("distinguishes 'not proved yet' from 'nobody was waiting'", () => {
    // A bare gate would reject real answers in the window between a wallet
    // confirming and the indexer writing the event — exactly the window the
    // feature exists for. Pending stamps nothing and loses nothing.
    const c = code("src/lib/challenge.server.ts");
    expect(c).toMatch(/pending: true/);
    expect(c).toMatch(/closed: \[\], pending: false/);
    // And the distinction survives the wire rather than being flattened.
    expect(code("src/lib/challenge.functions.ts")).toMatch(
      /Promise<\{\s*closed: NamedPerson\[\]; pending: boolean; parentCall: number \| null;?\s*\}>/,
    );
  });
});

describe("the audience is frozen when the Challenge goes up", () => {
  it("writes the recipients once, at creation", () => {
    // The denominator behind "3 of 8" is only worth printing if it cannot drift.
    // Recomputing the audience later would silently rewrite history every time
    // somebody's DNA moved.
    const c = code("src/lib/table.server.ts");
    expect(c).toMatch(/challenge_id: id/);
    expect(c).toMatch(/relation_at_call: caller\.relation/);
  });

  /**
   * THE ATOMIC-INSERT BUG, ASSERTED CLOSED.
   *
   * This used to be a plain multi-row `.insert()` whose 23505 was swallowed, on
   * the belief that it was skipping the odd repeat. A multi-row INSERT is ATOMIC:
   * one duplicate rolls back the WHOLE statement. Because `market_calls`'s primary
   * key has no `closed_at` predicate, re-issuing a market that had been on the
   * table before collided on every row — so the Challenge went up having reached
   * NOBODY, printed no sentence, and could never auto-close, holding one of three
   * slots forever.
   */
  it("adds the new recipients instead of rolling the whole audience back", () => {
    const c = code("src/lib/table.server.ts");
    expect(c).toMatch(/from\("market_calls"\)\s*\.upsert\(/);
    expect(c).toMatch(/ignoreDuplicates: true/);
    expect(c).toMatch(/onConflict: "market_id,caller_wallet,responder_wallet"/);
  });

  it("carries unanswered calls onto the new Challenge, and only unanswered ones", () => {
    // Somebody who never answered the first run is still being asked. Somebody who
    // showed up stays attached to the run they showed up for — history belongs to
    // the Challenge it actually happened under.
    const c = code("src/lib/table.server.ts");
    const carry = c.slice(c.indexOf("const carried = await sb"), c.indexOf("const inserted"));
    expect(carry).toMatch(/update\(\{ challenge_id: id \}\)/);
    expect(carry).toMatch(/\.is\("responded_at", null\)/);
    expect(carry).toMatch(/\.is\("passed_at", null\)/);
    // The relationship a call was made under is written once and never rewritten.
    expect(carry).not.toMatch(/relation_at_call/);
  });

  it("reports what it actually reached, not what it hoped to", () => {
    // `reached: audience.length` was returned whether or not a single row landed,
    // which is how the rollback above stayed invisible for as long as it did.
    const c = code("src/lib/table.server.ts");
    expect(c).toMatch(/reached: reached\.size/);
    expect(c).not.toMatch(/reached: audience\.length/);
  });

  it("does not spend a slot on a Challenge nobody can receive", () => {
    // A person would spend one of three editorial choices on silence, with no way
    // to know why. Resolved before the slot is taken.
    const c = code("src/lib/table.server.ts");
    expect(c.indexOf("no_audience")).toBeLessThan(c.indexOf('from("challenges")'));
  });

  it("reuses the one relationship ledger rather than inventing a second", () => {
    // Recipients ARE calls — the same rows People and Profile read, with the same
    // frozen relation. V2 only adds which deliberate act produced them.
    const c = code("src/lib/table.server.ts");
    expect(c).not.toMatch(/challenge_recipients|challenge_calls/);
  });
});

describe("the cap is collided with, never counted", () => {
  it("walks the slots and lets the index reject a taken one", () => {
    // Counting active rows then inserting is a read-then-write race two tabs win.
    // The loop is the allocator, not a retry.
    const c = code("src/lib/table.server.ts");
    expect(c).toMatch(/for \(let slot = 1; slot <= TABLE_SLOTS; slot\+\+\)/);
    expect(c).toMatch(/error\?\.code !== CONFLICT/);
    // Falling out of the loop means Postgres said no three times.
    expect(c).toMatch(/if \(id == null\) return \{ ok: false, reason: "full" \}/);
  });

  it("tells a taken slot apart from a market already up", () => {
    // Both indexes raise 23505, and retrying into the next slot would be wrong
    // for the second — it would put the same question up twice.
    expect(code("src/lib/table.server.ts")).toMatch(/reason: "already_up"/);
  });
});

describe("closing frees a slot and erases nothing", () => {
  it("only ever sets closed_at, never deletes", () => {
    const c = code("src/lib/table.server.ts");
    expect(c).toMatch(/closed_at: new Date\(\)\.toISOString\(\)/);
    expect(c).not.toMatch(/\.delete\(\)/);
  });

  it("keeps 'I took it down' and 'everyone answered' distinguishable", () => {
    const c = code("src/lib/table.server.ts");
    expect(c).toMatch(/"all_responded"/);
    expect(c).toMatch(/reason: "creator" \| "all_responded"/);
  });

  it("auto-closes where somebody is already looking, not on a schedule", () => {
    // No worker, no cron, no drift between what the creator sees and what the
    // database holds — the close happens the first time anybody reads the table.
    const c = code("src/lib/table.server.ts");
    expect(c).toMatch(/shouldAutoClose\(recipients\)/);
  });

  it("never reports a failed read as an empty table", () => {
    // The confident zero this codebase keeps paying for.
    const c = code("src/lib/table.server.ts");
    const read = c.slice(c.indexOf("export async function tableFor"));
    expect(read).toMatch(/throw new Error\(error\.message\)/);
  });
});

describe("passing stays a Challenge fact and nothing more", () => {
  it("writes one column and never touches responded_at", () => {
    const c = code("src/lib/table.server.ts");
    // Bounded to passCall's own body — the slice used to run to end of file and
    // picked up `tableFor`'s reads of the very column it was checking for.
    const from = c.indexOf("export async function passCall");
    const pass = c.slice(from, c.indexOf("export async function", from + 10));
    expect(pass).toMatch(/update\(\{ passed_at:/);
    expect(pass).toMatch(/\.is\("responded_at", null\)/);
    expect(pass).not.toMatch(/responded_at: /);
  });

  it("is signed, because it is a durable claim about somebody's choice", () => {
    // Unsigned, anyone could mark anyone as having passed on a question they
    // never saw. Same guard the belief and house writes already use.
    const c = code("src/lib/table.functions.ts");
    for (const fn of ["putOnTable", "takeOffTable", "passOnCall"])
      expect(c.slice(c.indexOf(`export const ${fn}`))).toMatch(/assertWalletOwnership/);
  });

  it("keeps reading your own table unsigned", () => {
    // Reading grants nothing and names nobody not already computed for you.
    const c = code("src/lib/table.functions.ts");
    const get = c.slice(c.indexOf("export const getTable"), c.indexOf("export const putOnTable"));
    expect(get).not.toMatch(/assertWalletOwnership|session/);
  });
});

/**
 * THE ROW MUST SURVIVE ITS OWN CLOSE.
 *
 * `tableFor` read `.is("closed_at", null)` AND auto-closed anything everyone had
 * answered — in the same pass. So the best outcome this product can produce was
 * deleted in the render that discovered it, and the creator opened Yours to
 * nothing. Source-level, because the defect is the shape of a query.
 */
describe("a finished Challenge is not a deleted one", () => {
  const src = code("src/lib/table.server.ts");

  it("asks for what recently ended, not only for what is open", () => {
    expect(src).toMatch(/closed_at\.is\.null,closed_at\.gte\./);
  });

  it("keeps the row when it auto-closes instead of skipping it", () => {
    const fn = src.slice(src.indexOf("export async function tableFor"));
    // The old shape. `continue` here means the creator never finds out.
    expect(fn).not.toMatch(/all_responded"\);\s*continue;/);
    expect(fn).toMatch(/closeReason = "all_responded"/);
  });

  it("drops it only once it has aged out", () => {
    const fn = src.slice(src.indexOf("export async function tableFor"));
    expect(fn).toMatch(/!finishedVisible\(closedAtMs, now\)\) continue/);
  });

  it("counts only live rows against the cap", () => {
    // Without this, a week of good outcomes reads as a full table — the exact
    // opposite of what closing a Challenge means.
    expect(src).toMatch(/export function activeRows/);
    expect(src).toMatch(/activeRows\(await tableFor\(wallet\)\)\.length/);
  });
});

/**
 * PREVIEW AND SEND ARE ONE DEFINITION.
 *
 * MEASURED AGAINST PRODUCTION AT 32 PEOPLE across 26 of 284 positions. The
 * preview excluded only CURRENT directional holders, so somebody who bought in
 * March and sold in April counted as reachable — and the write excluded nobody
 * market-scoped at all. The number shown and the audience recorded were decided
 * by different rules, which makes the "8" in "3 of 8 showed up" a number the
 * reader was never actually promised.
 */
describe("who can be asked is decided once", () => {
  const server = () => code("src/lib/challenge.server.ts");

  it("resolves the audience through one shared function", () => {
    expect(server()).toMatch(/export async function eligibleAudience/);
    // The write path calls it rather than assembling its own set.
    expect(code("src/lib/table.server.ts")).toMatch(/await eligibleAudience\(sb, me, marketId\)/);
    expect(code("src/lib/table.server.ts")).not.toMatch(/await qualifiedCallers\(/);
  });

  it("excludes anyone who has EVER taken part, not just current holders", () => {
    // A wallet_beliefs row survives a full exit, which is exactly why its mere
    // existence is the right test: selling out does not un-answer the question.
    const fn = server().slice(server().indexOf("export async function eligibleAudience"));
    expect(fn).toMatch(/from\("wallet_beliefs"\)\s*\.select\("wallet"\)/);
    expect(fn.slice(0, fn.indexOf("market_calls"))).not.toMatch(/stance_side/);
  });

  it("excludes the author and anyone already asked, in any state", () => {
    const fn = server().slice(server().indexOf("export async function eligibleAudience"));
    expect(fn).toMatch(/author_wallet/);
    expect(fn).toMatch(/from\("market_calls"\)/);
    // ANY state — open means they hold it, answered and passed mean they replied.
    const asked = fn.slice(fn.indexOf('from("market_calls")'), fn.indexOf("markets"));
    expect(asked).not.toMatch(/responded_at|passed_at/);
  });

  it("FAILS CLOSED — a failed exclusion is a failed audience", () => {
    /**
     * THIS ASSERTION IS THE REVERSE OF THE ONE IT REPLACED, and the reversal is
     * the point. The first version kept everybody eligible on a failed read,
     * reasoning that overstating by one is recoverable. It is not one: a failed
     * participant query loses EVERY exclusion, so the write would Challenge
     * every person who had already answered the market.
     *
     * "Unknown is not zero" cuts both ways. An inclusion read that fails must
     * not become "nobody qualifies"; an exclusion read that fails must not
     * become permission.
     */
    const fn = server().slice(server().indexOf("export async function eligibleAudience"));
    for (const [guard, reason] of [
      ["participants.error", "participants_unavailable"],
      ["asked.error", "calls_unavailable"],
      ["market.error", "market_unavailable"],
    ])
      expect(fn).toContain(`if (${guard}) return refuse("${reason}"`);
    // And nothing may proceed past a refusal into the dropping loops.
    expect(fn.indexOf("const out = new Map(callers)")).toBeGreaterThan(fn.indexOf("market.error"));
  });

  it("spends no slot and writes no row when the audience is refused", () => {
    const c = code("src/lib/table.server.ts");
    expect(c).toMatch(
      /if \(resolved\.status === "failed"\) return \{ ok: false, reason: "audience_unavailable" \}/,
    );
    // The refusal happens BEFORE the slot allocator runs.
    expect(c.indexOf("audience_unavailable")).toBeLessThan(c.indexOf("for (let slot = 1"));
  });

  it("reports a refused reach as unknown rather than as nobody", () => {
    // Zero would render "nobody qualifies yet" — a confident claim about
    // somebody's network, made from a read that never completed.
    expect(server()).toMatch(/return \{ tribe: 0, rivals: 0, failed: true \}/);
  });

  it("leaves the unscoped reach question alone", () => {
    // With no market there is nothing to exclude against — "how many people could
    // my conviction reach at all" is a different question and keeps its answer.
    const fn = server().slice(server().indexOf("export async function callReachFor"));
    expect(fn).toMatch(/callers = await qualifiedCallers\(sb, me\)/);
    expect(fn).toMatch(/eligibleAudience\(sb, me, marketId\)/);
  });
});
