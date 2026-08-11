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

/**
 * THE WRITE MOVED INTO SQL, AND SO DID THESE ASSERTIONS.
 *
 * The decisions below are unchanged — the freeze, the upsert, the carry, the
 * collided-with cap. They are now enforced inside `put_on_table`, because doing
 * them in four round trips could leave a Challenge that exists and asks nobody.
 * The behaviour is proved end-to-end in `put-on-table.pg.test.ts` against a real
 * cluster; these lock the decisions in the file that now makes them, so a future
 * edit cannot quietly un-make one.
 */
const RPC = () => code("supabase/migrations/20260908000000_put_on_table_atomic.sql");

describe("the audience is frozen when the Challenge goes up", () => {
  it("writes the recipients once, at creation", () => {
    // The denominator behind "3 of 8" is only worth printing if it cannot drift.
    // Recomputing the audience later would silently rewrite history every time
    // somebody's DNA moved.
    expect(RPC()).toMatch(
      /INSERT INTO market_calls \(\s*market_id, caller_wallet, responder_wallet, relation_at_call, challenge_id/,
    );
    expect(RPC()).toMatch(/a->>'relation'/);
    // THE RELATION, NEVER THE GROUP. A row storing "forming" would make a screen
    // heading permanent, and the day the heading was renamed every historical row
    // would be lying about what the engine actually knew.
    expect(RPC()).not.toMatch(/'forming'/);
    expect(code("src/lib/table.server.ts")).toMatch(/relation: m\.relationAtCall/);
    expect(code("src/lib/table.server.ts")).not.toMatch(/m\.group/);
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
    expect(RPC()).toMatch(/ON CONFLICT \(market_id, caller_wallet, responder_wallet\) DO NOTHING/);
  });

  it("carries unanswered calls onto the new Challenge, and only unanswered ones", () => {
    // Somebody who never answered the first run is still being asked. Somebody who
    // showed up stays attached to the run they showed up for — history belongs to
    // the Challenge it actually happened under.
    const c = RPC();
    const carry = c.slice(c.indexOf("UPDATE market_calls"), c.indexOf("INSERT INTO market_calls"));
    expect(carry).toMatch(/SET challenge_id = v_id/);
    expect(carry).toMatch(/responded_at IS NULL/);
    expect(carry).toMatch(/passed_at IS NULL/);
    // The relationship a call was made under is written once and never rewritten.
    expect(carry).not.toMatch(/relation_at_call/);
  });

  it("reports what it actually reached, not what it hoped to", () => {
    /**
     * `reached: audience.length` was returned whether or not a single row landed,
     * which is how the ghost stayed invisible for as long as it did. The count is
     * now read back from the rows, inside the same transaction that wrote them.
     */
    expect(RPC()).toMatch(
      /SELECT count\(\*\) INTO v_reached FROM market_calls WHERE challenge_id = v_id/,
    );
    expect(code("src/lib/table.server.ts")).not.toMatch(/reached: audience\.length/);
    // And the caller re-checks it rather than trusting `ok` alone.
    expect(code("src/lib/table.server.ts")).toMatch(/\(res\.reached \?\? 0\) > 0/);
  });

  /**
   * THE INVARIANT, IN THE ONE PLACE THAT CAN ENFORCE IT.
   *
   * A Challenge asking nobody holds one of three editorial slots forever: it
   * prints no progress sentence, and `allResponded` is false at zero so
   * `shouldAutoClose` can never fire. The old code produced exactly that and
   * returned ok:true.
   */
  it("rolls back rather than leaving a Challenge that reached nobody", () => {
    const c = RPC();
    expect(c).toMatch(/IF v_reached = 0 THEN[\s\S]*?RAISE EXCEPTION/);
    // A raise, not a close. A compensating close cannot restore the carried calls
    // this sequence has already repointed.
    const body = c.slice(
      c.indexOf("IF v_reached = 0"),
      c.indexOf("RETURN jsonb_build_object('ok', true"),
    );
    expect(body).not.toMatch(/UPDATE challenges|closed_at/);
  });

  it("does not spend a slot on a Challenge nobody can receive", () => {
    // A person would spend one of three editorial choices on silence, with no way
    // to know why. Refused before the transaction opens, and again inside it.
    const c = code("src/lib/table.server.ts");
    expect(c.indexOf("no_audience")).toBeLessThan(c.indexOf('rpc("put_on_table"'));
    expect(RPC().indexOf("'no_audience'")).toBeLessThan(RPC().indexOf("INSERT INTO challenges"));
  });

  it("reuses the one relationship ledger rather than inventing a second", () => {
    // Recipients ARE calls — the same rows People and Profile read, with the same
    // frozen relation. V2 only adds which deliberate act produced them.
    expect(code("src/lib/table.server.ts")).not.toMatch(/challenge_recipients|challenge_calls/);
    expect(RPC()).not.toMatch(/challenge_recipients|challenge_calls/);
  });
});

describe("the whole write is one transaction, or none of it", () => {
  it("does every write inside a block with an exception handler", () => {
    /**
     * A plpgsql block with an EXCEPTION handler is a subtransaction — reaching
     * the handler undoes every row the block touched. That is the entire
     * mechanism, so the slot allocation must be INSIDE it. Moving the INSERT
     * above the block would commit the slot and restore the ghost.
     */
    const c = RPC();
    const blockStart = c.indexOf("  BEGIN\n    -- THE CAP");
    const handler = c.indexOf("EXCEPTION WHEN OTHERS THEN");
    expect(blockStart).toBeGreaterThan(-1);
    for (const write of [
      "INSERT INTO challenges",
      "UPDATE market_calls",
      "INSERT INTO market_calls",
    ]) {
      expect(c.indexOf(write)).toBeGreaterThan(blockStart);
      expect(c.indexOf(write)).toBeLessThan(handler);
    }
  });

  it("never falls back to the multi-write path when the function is missing", () => {
    /**
     * PGRST202 is "no function matches" — the migration is not applied. Falling
     * back would restore the exact defect this replaces, and a Challenge that
     * never went up is recoverable in a way a ghost holding a slot is not.
     */
    const c = code("src/lib/table.server.ts");
    expect(c).toMatch(/PGRST202/);
    expect(c).not.toMatch(/from\("challenges"\)\s*\.insert\(/);
    expect(c).not.toMatch(/from\("market_calls"\)\s*\.upsert\(/);
  });

  it("validates the lineage pointer rather than trusting it", () => {
    // The foreign key only proves the call EXISTS. A chain drawn from an
    // unchecked pointer would say "Maya → Sundeep → You" on a number alone.
    const c = RPC();
    const check = c.slice(c.indexOf("IF p_parent_call IS NOT NULL"), c.indexOf("'bad_parent'"));
    expect(check).toMatch(/c\.market_id = p_market_id/);
    expect(check).toMatch(/c\.responder_wallet = v_me/);
    expect(check).toMatch(/c\.responded_at IS NOT NULL/);
  });
});

describe("the cap is collided with, never counted", () => {
  it("walks the slots and lets the index reject a taken one", () => {
    // Counting active rows then inserting is a read-then-write race two tabs win.
    // The loop is the allocator, not a retry.
    const c = RPC();
    expect(c).toMatch(/FOR v_slot IN 1\.\.3 LOOP/);
    expect(c).toMatch(/EXCEPTION WHEN unique_violation THEN/);
    // Falling out of the loop means Postgres said no three times.
    expect(c).toMatch(/'reason', 'full'/);
    // And nothing counts rows to decide it.
    expect(c).not.toMatch(/count\(\*\)[\s\S]{0,80}FROM challenges/);
  });

  it("tells a taken slot apart from a market already up", () => {
    // Both indexes raise 23505, and retrying into the next slot would be wrong
    // for the second — it would put the same question up twice. Asked before the
    // walk, and again after it, so a tab that won the race is not called "full".
    const c = RPC();
    expect((c.match(/'reason', 'already_up'/g) ?? []).length).toBe(2);
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
    expect(fn.indexOf("const excluded = new Set<string>()")).toBeGreaterThan(
      fn.indexOf("market.error"),
    );
  });

  /**
   * THE INCLUSION SIDE FAILS CLOSED TOO, and it did not used to.
   *
   * `qualifiedCallers` destructures `{ data }` and throws the error away, so an
   * unreadable DNA cache came back as a viewer with no network — indistinguishable
   * from a genuine cold start, and the caller would then report "nobody qualifies
   * yet" about somebody with a full Tribe. Same rule, other direction.
   */
  it("refuses rather than reporting an empty network when the DNA read fails", () => {
    const fn = server().slice(server().indexOf("async function dnaCandidates"));
    expect(fn.slice(0, fn.indexOf("const rows"))).toMatch(
      /if \(error\)[\s\S]*return \{ status: "failed" \}/,
    );
    const audience = server().slice(server().indexOf("export async function eligibleAudience"));
    expect(audience).toContain('return { status: "failed", reason: "dna_unavailable" }');
    expect(audience).toContain('return { status: "failed", reason: "calls_unavailable" }');
  });

  /**
   * STILL FORMING IS BOUNDED BY PROVENANCE, NOT BY A NEED FOR RECIPIENTS.
   *
   * Three doors, each a fact the canonical graph can already explain. The
   * assertions that matter most are the ABSENCES: no follow read, and no
   * participant/active-wallet sweep. Either one would let a stranger appear
   * socially connected, which is the one thing an audience must never do.
   */
  it("admits exactly three provenances, and follows are not one of them", () => {
    const s = server();
    const dna = s.slice(
      s.indexOf("async function dnaCandidates"),
      s.indexOf("async function answeredCandidates"),
    );
    expect(dna).toMatch(/take\(data\?\.neutral_matches, "neutral", "neutral_dna"\)/);
    expect(dna).toMatch(
      /take\(data\?\.closest_matches, "insufficient", "closest_match", CLOSEST_MIN_SHARED\)/,
    );

    const answered = s.slice(s.indexOf("async function answeredCandidates"));
    const body = answered.slice(0, answered.indexOf("export async function"));
    // An ANSWER in either direction, and only an answer.
    expect(body).toMatch(/\.eq\("caller_wallet", viewer\)/);
    expect(body).toMatch(/\.eq\("responder_wallet", viewer\)/);
    expect((body.match(/\.not\("responded_at", "is", null\)/g) ?? []).length).toBe(2);
    // A pass is a decline and an unanswered call is one person's hope. Neither
    // may become a seat, so neither column is read at all.
    expect(body).not.toMatch(/passed_at/);

    // NO FOLLOWS. `setFollow` accepts the claimed follower wallet without proving
    // control of it, so a forged follow would manufacture an audience seat.
    expect(s).not.toMatch(/from\("follows"\)/);
  });

  it("decides membership before it resolves a single profile", () => {
    // A missing `profiles` row is a missing picture, not a revoked invitation.
    const fn = server().slice(server().indexOf("export async function audienceFor"));
    const body = fn.slice(0, fn.indexOf("\n}\n"));
    expect(body.indexOf("eligibleAudience")).toBeLessThan(body.indexOf("resolveProfiles"));
    // And the read that decides membership never mentions profiles at all.
    const membership = server().slice(
      server().indexOf("export async function eligibleAudience"),
      server().indexOf("export async function audienceFor"),
    );
    expect(membership).not.toMatch(/resolveProfiles|displayName/);
  });

  it("spends no slot and writes no row when the audience is refused", () => {
    const c = code("src/lib/table.server.ts");
    expect(c).toMatch(
      /if \(resolved\.status === "failed"\) return \{ ok: false, reason: "audience_unavailable" \}/,
    );
    // The refusal happens BEFORE the transaction is even opened, so there is no
    // slot to give back and nothing to compensate for.
    expect(c.indexOf("audience_unavailable")).toBeLessThan(c.indexOf('rpc("put_on_table"'));
  });

  it("reports a refused reach as unknown rather than as nobody", () => {
    // Zero would render "nobody qualifies yet" — a confident claim about
    // somebody's network, made from a read that never completed.
    expect(server()).toMatch(/return \{ tribe: 0, rivals: 0, forming: 0, failed: true \}/);
  });

  it("asks the unscoped question the same way, minus the exclusions", () => {
    /**
     * With no market there is nothing to exclude against — but the POOL must be
     * the same three doors. Reading only the strong buckets here would make the
     * unscoped line SMALLER than the scoped one for the same viewer, which reads
     * as "asking about one market reaches more people than asking in general".
     */
    const fn = server().slice(server().indexOf("export async function callReachFor"));
    expect(fn).toMatch(/dnaCandidates\(sb, me\)/);
    expect(fn).toMatch(/answeredCandidates\(sb, me\)/);
    expect(fn).toMatch(/eligibleAudience\(sb, me, marketId\)/);
  });

  it("counts the reach with the function that renders the headings", () => {
    // Two places deciding what "Tribe" means is how preview and write came to
    // disagree by 32 people. `audienceGroupFor` is exhaustive over the six.
    const fn = server().slice(server().indexOf("export async function callReachFor"));
    expect(fn).toMatch(/audienceGroupFor\(relation\)/);
    // The third group is counted, because the write now reaches it.
    expect(fn).toMatch(/return \{ tribe, rivals, forming \}/);
  });
});
