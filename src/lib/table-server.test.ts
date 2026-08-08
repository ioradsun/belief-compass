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
    expect(c).toMatch(/if \(!\(await tookAPosition\(sb, wallet, marketId\)\)\)/);
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
      /Promise<\{ closed: NamedPerson\[\]; pending: boolean \}>/,
    );
  });
});

describe("the audience is frozen when the Challenge goes up", () => {
  it("writes the recipients once, at creation", () => {
    // The denominator behind "3 of 8" is only worth printing if it cannot drift.
    // Recomputing the audience later would silently rewrite history every time
    // somebody's DNA moved.
    const c = code("src/lib/table.server.ts");
    expect(c).toMatch(/from\("market_calls"\)\.insert\(/);
    expect(c).toMatch(/challenge_id: id/);
    expect(c).toMatch(/relation_at_call: caller\.relation/);
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
