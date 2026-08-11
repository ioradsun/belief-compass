/**
 * `put_on_table` AGAINST A REAL POSTGRES — because the claim is about atomicity.
 *
 * Every other test in this repo either exercises pure domain functions or greps
 * source for a decision that must not be un-made. Neither can prove this one.
 * The invariant here is TRANSACTIONAL:
 *
 *   ok = true   →  a durable, active Challenge exists AND reached > 0
 *   ok = false  →  no Challenge exists, no slot was consumed, and no carried
 *                  call was repointed
 *
 * "No slot was consumed" is a statement about what survives a rollback, and a
 * mock cannot be wrong about a rollback it is simulating. So this runs the real
 * function, on a real cluster, and checks the tables afterwards.
 *
 * IT SKIPS ITSELF WHEN THERE IS NO CLUSTER, rather than failing CI on an absence.
 * Point it at one with PGURL and it runs:
 *
 *   initdb -D /var/tmp/pg -U postgres --auth=trust
 *   pg_ctl -D /var/tmp/pg -o '-p 5433 -k /tmp' start
 *   PGURL='postgres://postgres@localhost:5433/postgres' npx vitest run put-on-table.pg
 *
 * A skip is reported as a skip. It is not a pass, and the suite says so.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const PGURL = process.env.PGURL ?? "";
const ready = (() => {
  if (!PGURL) return false;
  try {
    execFileSync("psql", [PGURL, "-tAc", "select 1"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();

/** One statement or script, straight through psql. Throws on any error. */
const sql = (text: string): string =>
  execFileSync("psql", [PGURL, "-v", "ON_ERROR_STOP=1", "-tAc", text], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();

const file = (p: string) =>
  execFileSync("psql", [PGURL, "-v", "ON_ERROR_STOP=1", "-f", join(process.cwd(), p)], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });

const ME = "0xchallenger";
const MARKET = 4242;

interface Put {
  ok?: boolean;
  id?: number;
  reached?: number;
  reason?: string;
  detail?: string;
  code?: string;
}

/** Call the function exactly as `putOnTable` does. */
const put = (
  audience: { wallet: string; relation: string }[],
  { me = ME, market = MARKET, parent = null as number | null } = {},
): Put =>
  JSON.parse(
    sql(
      `select put_on_table(${lit(me)}, ${market}, ${parent == null ? "null" : parent}, ${lit(
        JSON.stringify(audience),
      )}::jsonb)`,
    ),
  ) as Put;

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const count = (table: string, where = "true") =>
  Number(sql(`select count(*) from ${table} where ${where}`));

const person = (wallet: string, relation: string) => ({ wallet, relation });

/**
 * A NARROWED CHECK, TO PROVE A REJECTION ROLLS BACK EVERYTHING.
 *
 * This is the unapplied 20260907 migration reproduced deliberately: with the
 * constraint back at four values, a Still Forming recipient is REJECTED by
 * Postgres. Reproducing it is the only honest way to test the failure the
 * production database can currently produce.
 */
const narrowTheCheck = () =>
  sql(`alter table market_calls drop constraint market_calls_relation;
       alter table market_calls add constraint market_calls_relation
         check (relation_at_call in ('twin','tribe','opp','inverse'))`);

const widenTheCheck = () =>
  sql(`alter table market_calls drop constraint market_calls_relation;
       alter table market_calls add constraint market_calls_relation
         check (relation_at_call in ('twin','tribe','neutral','opp','inverse','insufficient'))`);

describe.skipIf(!ready)("put_on_table is one transaction or none of it", () => {
  beforeAll(() => {
    sql("drop function if exists put_on_table(text,bigint,bigint,jsonb)");
    sql("drop table if exists market_calls cascade; drop table if exists challenges cascade");
    // Supabase provides this role; a bare cluster does not, and the GRANT at the
    // end of the migration is part of what is being tested.
    sql(
      "do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$",
    );
    file("scripts/put-on-table-schema.sql");
    file("supabase/migrations/20260908000000_put_on_table_atomic.sql");
  });

  beforeEach(() => {
    sql("truncate market_calls, challenges restart identity cascade");
    widenTheCheck();
  });

  afterAll(() => {
    if (ready) sql("truncate market_calls, challenges restart identity cascade");
  });

  /* ── The happy paths, including the ones that were unwriteable ─────────── */

  it("writes neutral and insufficient recipients", () => {
    // The two labels the four-value CHECK rejected. Still Forming was
    // unimplementable behind that line whatever the application did.
    const r = put([person("0xa", "neutral"), person("0xb", "insufficient")]);
    expect(r.ok).toBe(true);
    expect(r.reached).toBe(2);
    expect(count("market_calls", "relation_at_call = 'neutral'")).toBe(1);
    expect(count("market_calls", "relation_at_call = 'insufficient'")).toBe(1);
  });

  it("writes a mixed strong and forming audience in one go", () => {
    const r = put([
      person("0xa", "twin"),
      person("0xb", "tribe"),
      person("0xc", "opp"),
      person("0xd", "inverse"),
      person("0xe", "neutral"),
      person("0xf", "insufficient"),
    ]);
    expect(r.ok).toBe(true);
    expect(r.reached).toBe(6);
    // Every relation survives exactly as sent — the group is never stored.
    expect(sql("select count(distinct relation_at_call) from market_calls")).toBe("6");
    expect(count("market_calls", "relation_at_call = 'forming'")).toBe(0);
  });

  it("reports the reach it can prove, counted from durable rows", () => {
    const r = put([person("0xa", "twin"), person("0xb", "tribe"), person("0xc", "neutral")]);
    expect(r.reached).toBe(count("market_calls", `challenge_id = ${r.id}`));
    expect(r.reached).toBe(3);
  });

  it("counts a carried call in the reach, and does not duplicate it", () => {
    const first = put([person("0xa", "twin"), person("0xb", "tribe")]);
    expect(first.ok).toBe(true);
    // 0xa answers; 0xb never does. Then the question goes back up.
    sql("update market_calls set responded_at = now() where responder_wallet = '0xa'");
    sql(`update challenges set closed_at = now(), close_reason = 'creator' where id = ${first.id}`);

    // 0xb is now excluded upstream by `eligibleAudience` (already asked), so the
    // audience is only the new person — and 0xb still moves with the question.
    const second = put([person("0xc", "neutral")]);
    expect(second.ok).toBe(true);
    expect(second.reached).toBe(2);
    expect(count("market_calls", `challenge_id = ${second.id} and responder_wallet = '0xb'`)).toBe(
      1,
    );
    // A TERMINATED ROW NEVER MOVES. 0xa stays with the run they showed up for.
    expect(count("market_calls", `challenge_id = ${first.id} and responder_wallet = '0xa'`)).toBe(
      1,
    );
    // And the relationship a call was made under is never rewritten.
    expect(sql("select relation_at_call from market_calls where responder_wallet = '0xb'")).toBe(
      "tribe",
    );
  });

  /* ── Every refusal leaves nothing behind ───────────────────────────────── */

  it("rolls the whole thing back when a recipient violates a constraint", () => {
    /**
     * THE GHOST CHALLENGE, ASSERTED CLOSED. Before this function, the slot and
     * the `challenges` row were already committed by the time the recipient
     * write failed — so the old code logged the error and returned ok:true with
     * reached:0, leaving a Challenge that asks nobody and can never auto-close.
     */
    narrowTheCheck();
    const r = put([person("0xa", "twin"), person("0xb", "neutral")]);
    expect(r.ok).toBeFalsy();
    expect(r.reason).toBe("failed");
    expect(r.code).toBe("23514"); // check_violation
    expect(count("challenges")).toBe(0);
    expect(count("market_calls")).toBe(0);
  });

  it("consumes no slot on a constraint failure, so the next attempt gets slot 1", () => {
    narrowTheCheck();
    expect(put([person("0xa", "neutral")]).ok).toBeFalsy();
    widenTheCheck();
    const r = put([person("0xa", "neutral")]);
    expect(r.ok).toBe(true);
    expect(sql(`select slot_no from challenges where id = ${r.id}`)).toBe("1");
    expect(count("challenges")).toBe(1);
  });

  it("leaves no carried call repointed after a rollback", () => {
    /**
     * THE REASON A COMPENSATING CLOSE WOULD NOT HAVE WORKED. By the time the
     * recipient write fails, last run's unanswered calls have already been
     * repointed at the new Challenge. Closing it would strand those people —
     * their question quietly stops being asked and the pointer saying which
     * Challenge it belonged to has been overwritten. Only a rollback restores it.
     */
    const first = put([person("0xb", "tribe")]);
    expect(first.ok).toBe(true);
    sql(`update challenges set closed_at = now(), close_reason = 'creator' where id = ${first.id}`);

    narrowTheCheck();
    const second = put([person("0xa", "neutral")]);
    expect(second.ok).toBeFalsy();
    // 0xb still belongs to the Challenge it was written under.
    expect(sql("select challenge_id from market_calls where responder_wallet = '0xb'")).toBe(
      String(first.id),
    );
    expect(count("challenges")).toBe(1);
  });

  it("rolls back rather than leaving a Challenge that reached nobody", () => {
    /**
     * ZERO ACTUAL REACH. Every recipient already has a row from a Challenge that
     * is still open, so the upsert adds nothing and the carry moves nothing —
     * `challenge_id` on those rows belongs to the other Challenge. The result is
     * a Challenge asking no one, which is the corpse, arriving without any
     * error at all.
     */
    sql(`insert into challenges (challenger_wallet, market_id, slot_no)
         values ('0xother', 999, 1) returning id`);
    sql(`insert into market_calls (market_id, caller_wallet, responder_wallet, relation_at_call, challenge_id, responded_at)
         values (${MARKET}, ${lit(ME)}, '0xa', 'twin', 1, now())`);

    const r = put([person("0xa", "twin")]);
    expect(r.ok).toBeFalsy();
    expect(r.reason).toBe("no_reach");
    // The other Challenge is untouched; no new one exists.
    expect(count("challenges", `challenger_wallet = ${lit(ME)}`)).toBe(0);
    expect(sql("select challenge_id from market_calls where responder_wallet = '0xa'")).toBe("1");
  });

  it("refuses an empty audience without touching anything", () => {
    const r = put([]);
    expect(r.ok).toBeFalsy();
    expect(r.reason).toBe("no_audience");
    expect(count("challenges")).toBe(0);
  });

  /* ── Lineage is validated, not trusted ─────────────────────────────────── */

  it("refuses a parent_call that does not describe a relay", () => {
    // Somebody answered a call in a DIFFERENT market. The foreign key would
    // accept the pointer; a chain drawn from it would be fiction.
    sql(`insert into challenges (challenger_wallet, market_id, slot_no) values ('0xmaya', 77, 1)`);
    sql(`insert into market_calls (market_id, caller_wallet, responder_wallet, relation_at_call, challenge_id, responded_at)
         values (77, '0xmaya', ${lit(ME)}, 'twin', 1, now())`);
    const parent = Number(sql("select id from market_calls where market_id = 77"));

    const r = put([person("0xa", "twin")], { parent });
    expect(r.ok).toBeFalsy();
    expect(r.reason).toBe("bad_parent");
    expect(count("challenges", `challenger_wallet = ${lit(ME)}`)).toBe(0);
  });

  it("refuses a parent_call nobody answered", () => {
    sql(
      `insert into challenges (challenger_wallet, market_id, slot_no) values ('0xmaya', ${MARKET}, 1)`,
    );
    sql(`insert into market_calls (market_id, caller_wallet, responder_wallet, relation_at_call, challenge_id)
         values (${MARKET}, '0xmaya', ${lit(ME)}, 'twin', 1)`);
    const parent = Number(sql(`select id from market_calls where caller_wallet = '0xmaya'`));

    const r = put([person("0xa", "twin")], { parent });
    expect(r.reason).toBe("bad_parent");
    expect(count("challenges", `challenger_wallet = ${lit(ME)}`)).toBe(0);
  });

  it("refuses a parent_call that does not exist at all", () => {
    const r = put([person("0xa", "twin")], { parent: 999_999 });
    expect(r.reason).toBe("bad_parent");
    expect(count("challenges")).toBe(0);
  });

  it("accepts a real relay and records the lineage", () => {
    sql(
      `insert into challenges (challenger_wallet, market_id, slot_no) values ('0xmaya', ${MARKET}, 1)`,
    );
    sql(`insert into market_calls (market_id, caller_wallet, responder_wallet, relation_at_call, challenge_id, responded_at)
         values (${MARKET}, '0xmaya', ${lit(ME)}, 'twin', 1, now())`);
    const parent = Number(sql(`select id from market_calls where caller_wallet = '0xmaya'`));

    const r = put([person("0xa", "neutral")], { parent });
    expect(r.ok).toBe(true);
    expect(sql(`select parent_call from challenges where id = ${r.id}`)).toBe(String(parent));
  });

  /* ── The cap, still collided with ──────────────────────────────────────── */

  it("refuses a market that is already up, and says so", () => {
    const first = put([person("0xa", "twin")]);
    expect(first.ok).toBe(true);
    const again = put([person("0xb", "tribe")]);
    expect(again.ok).toBeFalsy();
    // NOT "full" — the table has two free slots and the reader needs the
    // difference between "you already asked this" and "you are out of room".
    expect(again.reason).toBe("already_up");
    expect(count("challenges")).toBe(1);
    expect(count("market_calls")).toBe(1);
  });

  it("refuses a fourth Challenge without writing a recipient row", () => {
    for (const m of [1, 2, 3]) {
      const r = put([person(`0x${m}`, "twin")], { market: m });
      expect(r.ok).toBe(true);
    }
    const fourth = put([person("0xz", "twin")], { market: 4 });
    expect(fourth.ok).toBeFalsy();
    expect(fourth.reason).toBe("full");
    expect(count("challenges")).toBe(3);
    expect(count("market_calls")).toBe(3);
    expect(count("market_calls", "responder_wallet = '0xz'")).toBe(0);
  });

  it("frees the slot when one closes, and the next attempt takes it", () => {
    for (const m of [1, 2, 3]) put([person(`0x${m}`, "twin")], { market: m });
    sql("update challenges set closed_at = now(), close_reason = 'creator' where slot_no = 2");
    const r = put([person("0xz", "neutral")], { market: 4 });
    expect(r.ok).toBe(true);
    expect(sql(`select slot_no from challenges where id = ${r.id}`)).toBe("2");
  });

  /* ── The audience it is given ──────────────────────────────────────────── */

  it("never writes the caller into their own audience", () => {
    // `market_calls_not_self` would reject it and roll the whole Challenge back,
    // so the row is dropped rather than allowed to become a rejection.
    const r = put([person(ME, "twin"), person("0xa", "twin")]);
    expect(r.ok).toBe(true);
    expect(r.reached).toBe(1);
    expect(count("market_calls", `responder_wallet = ${lit(ME)}`)).toBe(0);
  });

  it("lowercases every wallet it stores", () => {
    const r = put([person("0xABCDEF", "tribe")]);
    expect(r.ok).toBe(true);
    expect(sql("select responder_wallet from market_calls")).toBe("0xabcdef");
  });
});

/**
 * WHEN THERE IS NO CLUSTER, SAY SO OUT LOUD.
 *
 * A silently skipped suite reads as a passing one in a summary line, and this is
 * the only suite in the repo that can prove the rollback. The reminder is cheap
 * and the alternative is a green run that checked nothing.
 */
describe("the transactional suite reports its own absence", () => {
  it(ready ? "ran against a real cluster" : "SKIPPED — set PGURL to run it", () => {
    if (!ready) {
      console.warn(
        "[put-on-table.pg] no PGURL — the atomicity of put_on_table was NOT verified in this run.",
      );
    }
    expect(true).toBe(true);
  });
});

/**
 * THE FIXTURE MUST NOT DRIFT FROM THE MIGRATIONS.
 *
 * Runs everywhere, cluster or not. A constraint relaxed in the test schema and
 * not in production would make every test above weaker than the thing it claims
 * to prove — silently, and in the direction that always looks like a pass.
 */
describe("the test schema mirrors the real constraints", () => {
  const fixture = readFileSync(join(process.cwd(), "scripts/put-on-table-schema.sql"), "utf8");
  const migration = (p: string) =>
    readFileSync(join(process.cwd(), `supabase/migrations/${p}`), "utf8");

  it("keeps the six-value relation CHECK", () => {
    for (const r of ["twin", "tribe", "neutral", "opp", "inverse", "insufficient"])
      expect(fixture).toContain(`'${r}'`);
    expect(migration("20260907000000_call_relation_forming.sql")).toContain("'insufficient'");
  });

  it("keeps both partial unique indexes that ARE the cap", () => {
    expect(fixture).toMatch(/challenges_active_slot_idx[\s\S]*?WHERE closed_at IS NULL/);
    expect(fixture).toMatch(/challenges_active_market_idx[\s\S]*?WHERE closed_at IS NULL/);
  });

  it("keeps the composite primary key that makes a repeat call impossible", () => {
    expect(fixture).toContain("PRIMARY KEY (market_id, caller_wallet, responder_wallet)");
    expect(fixture).toContain("market_calls_not_self");
  });
});
