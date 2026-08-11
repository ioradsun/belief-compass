/**
 * THE SIMULATION LEDGER AGAINST A REAL POSTGRES — because the claims are about
 * transactions, constraints and races, and a mock cannot be wrong about those.
 *
 * `simulation-boundary.test.ts` is the static guardrail: it proves the code does
 * not CONTAIN a contract write or a real-table write. It cannot prove that two
 * concurrent submissions return the same order, that a real call and a Simulation
 * call can coexist, or that a failed order leaves nothing behind. Those are
 * properties of the database, so they are tested on one.
 *
 * IT SKIPS ITSELF WHEN THERE IS NO CLUSTER, and a skip is reported as a skip
 * rather than as a pass. Point it at one with PGURL, or run `npm run test:pg`.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
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

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const count = (table: string, where = "true") =>
  Number(sql(`select count(*) from ${table} where ${where}`));
const one = (q: string) => sql(q);

const ME = "0xsimulator";
const OTHER = "0xother";
const MARKET = 7001;
const TARGET = 10;
const START = 1000;

interface OrderResult {
  ok?: boolean;
  replayed?: boolean;
  reason?: string;
  available?: string | number;
  order?: { id: number; amount_cc: string; share_delta: string; request_fingerprint: string };
  account?: { available_balance_cc: string; state: string };
  position?: { yes_shares: string; no_shares: string; last_directional_side: string | null };
  convictions?: number;
  answered?: string[];
}

/** Call `simulation_execute_order` exactly as the server does. */
const order = (
  o: {
    wallet?: string;
    market?: number;
    side?: "YES" | "NO";
    action?: "BUY" | "SELL";
    amount?: number;
    shares?: number;
    key?: string;
    fingerprint?: string;
    target?: number;
  } = {},
): OrderResult => {
  const wallet = o.wallet ?? ME;
  const market = o.market ?? MARKET;
  const side = o.side ?? "YES";
  const action = o.action ?? "BUY";
  const amount = o.amount ?? 100;
  const shares = o.shares ?? 200;
  const key = o.key ?? `k-${Math.random().toString(36).slice(2)}`;
  const print = o.fingerprint ?? `${market}:${side}:${action}:${amount.toFixed(6)}`;
  return JSON.parse(
    sql(
      `select simulation_execute_order(${lit(wallet)}, ${market}, ${lit(side)}, ${lit(action)},
       ${amount}, ${shares}, 0.42, 1.2, ${lit(key)}, 0.15, ${o.target ?? TARGET}, ${lit(print)})`,
    ),
  ) as OrderResult;
};

const activate = (wallet = ME) =>
  JSON.parse(sql(`select simulation_activate(${lit(wallet)}, ${START}, ${TARGET})`)) as {
    ok?: boolean;
    reason?: string;
  };

const exit_ = (wallet = ME, graduate = false) =>
  JSON.parse(sql(`select simulation_exit(${lit(wallet)}, ${graduate})`)) as {
    ok?: boolean;
    account?: { state: string };
  };

/** Give a wallet N convictions, so eligibility can be steered. */
const giveConvictions = (wallet: string, n: number) => {
  if (n <= 0) return;
  const rows = Array.from(
    { length: n },
    (_, i) => `(${lit(wallet)}, ${90000 + i}, 'YES', 0.15, 'tap')`,
  ).join(",");
  sql(
    `insert into expressed_beliefs (wallet, onchain_id, side, weight, source)
     values ${rows} on conflict do nothing`,
  );
};

describe.skipIf(!ready)("the Simulation ledger, on a real cluster", () => {
  beforeAll(() => {
    sql(
      "do $$ begin if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if; end $$",
    );
    sql(`drop table if exists simulation_house_rounds, simulation_orders,
         simulation_positions, simulation_accounts,
         market_calls, challenges, wallet_beliefs, expressed_beliefs, match_queue cascade`);
    file("scripts/simulation-schema.sql");
    file("supabase/migrations/20260908000000_put_on_table_atomic.sql");
    // The migration under test lands on the pre-Simulation schema, exactly as it
    // will in production — including the market_calls primary-key ALTER.
    file("supabase/migrations/20260909000000_simulation_mode.sql");
  });

  beforeEach(() => {
    sql(`truncate simulation_house_rounds, simulation_orders, simulation_positions,
         simulation_accounts, market_calls, challenges, wallet_beliefs,
         expressed_beliefs, match_queue restart identity cascade`);
  });

  /* ── 2 · Idempotency ─────────────────────────────────────────────────────── */

  describe("the same order submitted twice is one order", () => {
    it("replays the settled result instead of spending CC twice", () => {
      activate();
      const first = order({ key: "same" });
      expect(first.ok).toBe(true);
      expect(first.replayed).toBe(false);

      const second = order({ key: "same" });
      expect(second.ok).toBe(true);
      expect(second.replayed).toBe(true);
      expect(second.order?.id).toBe(first.order?.id);

      // One row, one debit. The balance is what proves it.
      expect(count("simulation_orders")).toBe(1);
      expect(Number(one("select available_balance_cc from simulation_accounts"))).toBe(START - 100);
    });

    it("replays even when the pre-lock check is bypassed — the post-lock one catches it", () => {
      // Both concurrent submissions miss the cheap check; the second acquires the
      // lock in a world where the order already exists. Without the recheck it
      // would collide with the unique index and FAIL rather than replay.
      activate();
      order({ key: "racy" });
      // Simulate the loser of the race arriving after the winner committed.
      const late = order({ key: "racy" });
      expect(late.ok).toBe(true);
      expect(late.replayed).toBe(true);
      expect(count("simulation_orders")).toBe(1);
    });

    it("rejects the same key carrying a different order", () => {
      activate();
      order({ key: "dup", amount: 100 });
      const mismatch = order({ key: "dup", amount: 250 });
      expect(mismatch.ok).toBe(false);
      expect(mismatch.reason).toBe("idempotency_conflict");
      // And nothing was written for the second attempt.
      expect(count("simulation_orders")).toBe(1);
      expect(Number(one("select available_balance_cc from simulation_accounts"))).toBe(START - 100);
    });

    it("lets two wallets use the same key value independently", () => {
      // A key is a CLIENT value. One person's cannot refuse another's order.
      activate(ME);
      activate(OTHER);
      const mine = order({ wallet: ME, key: "shared-key" });
      const theirs = order({ wallet: OTHER, key: "shared-key" });
      expect(mine.ok).toBe(true);
      expect(theirs.ok).toBe(true);
      expect(theirs.replayed).toBe(false);
      expect(count("simulation_orders")).toBe(2);
    });

    it("replays without needing anything but the row", () => {
      activate();
      const first = order({ key: "replayable", fingerprint: "fp" });
      const replay = JSON.parse(
        sql(`select simulation_replay_order(${lit(ME)}, 'replayable', 'fp')`),
      ) as OrderResult;
      expect(replay.ok).toBe(true);
      expect(replay.order?.id).toBe(first.order?.id);
      expect(replay.account?.available_balance_cc).toBeDefined();
    });
  });

  /* ── 9 · Atomicity ───────────────────────────────────────────────────────── */

  describe("a refused order leaves nothing behind", () => {
    it("writes no order, no position, no balance change and no belief", () => {
      activate();
      const refused = order({ amount: 5000 }); // more CC than exists
      expect(refused.ok).toBe(false);
      expect(refused.reason).toBe("insufficient_cc");

      expect(count("simulation_orders")).toBe(0);
      expect(count("simulation_positions")).toBe(0);
      expect(count("expressed_beliefs", "source = 'simulation'")).toBe(0);
      expect(count("match_queue")).toBe(0);
      expect(Number(one("select available_balance_cc from simulation_accounts"))).toBe(START);
    });

    it("refuses a sell of shares that are not held, changing nothing", () => {
      activate();
      const refused = order({ action: "SELL", shares: 10 });
      expect(refused.ok).toBe(false);
      expect(refused.reason).toBe("insufficient_shares");
      expect(count("simulation_orders")).toBe(0);
      expect(Number(one("select available_balance_cc from simulation_accounts"))).toBe(START);
    });

    it("writes the order, position, balance, belief and refresh together", () => {
      activate();
      const ok = order();
      expect(ok.ok).toBe(true);
      expect(count("simulation_orders")).toBe(1);
      expect(Number(one("select yes_shares from simulation_positions"))).toBe(200);
      expect(Number(one("select available_balance_cc from simulation_accounts"))).toBe(START - 100);
      expect(count("expressed_beliefs", "source = 'simulation'")).toBe(1);
      expect(one("select side from expressed_beliefs where source = 'simulation'")).toBe("YES");
      // The DNA trigger only fires on wallet_beliefs, so the belief must enqueue
      // its own recompute or the Network never learns about it.
      expect(count("match_queue", "pending")).toBe(1);
    });

    it("never lets the balance go negative, whatever is asked of it", () => {
      activate();
      expect(order({ amount: START }).ok).toBe(true);
      expect(order({ amount: 1 }).ok).toBe(false);
      expect(Number(one("select available_balance_cc from simulation_accounts"))).toBe(0);
    });
  });

  /* ── The belief bridge ───────────────────────────────────────────────────── */

  describe("what a Simulation position expresses", () => {
    it("writes the fixed expressed weight, never the CC committed", () => {
      activate();
      order({ amount: 900 });
      expect(Number(one("select weight from expressed_beliefs where source='simulation'"))).toBe(
        0.15,
      );
    });

    it("expresses nothing from a perfectly balanced position", () => {
      activate();
      order({ side: "YES", shares: 100, amount: 50, key: "a" });
      order({ side: "NO", shares: 100, amount: 50, key: "b" });
      // Both sides held equally: the direction is the last unambiguous one, and
      // the position itself makes no new claim.
      expect(Number(one("select yes_shares from simulation_positions"))).toBe(100);
      expect(Number(one("select no_shares from simulation_positions"))).toBe(100);
      expect(count("expressed_beliefs", "source = 'simulation'")).toBe(1);
    });

    it("counts one conviction per market however many orders it took", () => {
      activate();
      order({ key: "1" });
      order({ key: "2" });
      order({ key: "3", side: "NO", amount: 10, shares: 5 });
      expect(order({ key: "4" }).convictions).toBe(1);
    });
  });

  /* ── 7 · Lifecycle ───────────────────────────────────────────────────────── */

  describe("the tenth conviction ends Simulation inside the transaction", () => {
    it("moves the account to GRADUATING as the tenth settles", () => {
      activate();
      giveConvictions(ME, 9);
      const tenth = order();
      expect(tenth.ok).toBe(true);
      expect(tenth.convictions).toBe(10);
      expect(tenth.account?.state).toBe("GRADUATING");
      expect(one("select state from simulation_accounts")).toBe("GRADUATING");
    });

    it("refuses an eleventh order", () => {
      activate();
      giveConvictions(ME, 9);
      order({ key: "tenth" });
      const eleventh = order({ key: "eleventh", market: MARKET + 1 });
      expect(eleventh.ok).toBe(false);
      expect(eleventh.reason).toBe("inactive");
    });

    it("cannot be activated at or above ten", () => {
      giveConvictions(ME, 10);
      const res = activate();
      expect(res.ok).toBe(false);
      expect(res.reason).toBe("not_eligible");
      expect(count("simulation_accounts")).toBe(0);
    });

    it("grants the starting balance exactly once across re-entries", () => {
      activate();
      order({ amount: 400 });
      exit_();
      activate();
      expect(Number(one("select available_balance_cc from simulation_accounts"))).toBe(START - 400);
      // And the positions survived the round trip.
      expect(count("simulation_positions")).toBe(1);
    });

    it("never reactivates a graduated account", () => {
      activate();
      exit_(ME, true);
      expect(one("select state from simulation_accounts")).toBe("GRADUATED");
      const again = activate();
      expect(again.ok).toBe(false);
      expect(again.reason).toBe("graduated");
      expect(one("select state from simulation_accounts")).toBe("GRADUATED");
    });
  });

  /* ── 5 · The two call ledgers ────────────────────────────────────────────── */

  describe("real and Simulation Challenges do not consume each other", () => {
    const put = (mode: "REAL" | "SIMULATION", caller = ME, responder = OTHER, market = MARKET) =>
      JSON.parse(
        sql(
          `select put_on_table(${lit(caller)}, ${market}, null,
           ${lit(JSON.stringify([{ wallet: responder, relation: "twin" }]))}::jsonb, ${lit(mode)})`,
        ),
      ) as { ok?: boolean; reached?: number; reason?: string };

    it("lets the same pair be called on the same market in both ledgers", () => {
      // With mode outside the key, the real call silently swallowed the
      // Simulation one — the audience write dropped the person and the Challenge
      // reached one fewer than it reported.
      expect(put("REAL").ok).toBe(true);
      expect(put("SIMULATION").ok).toBe(true);
      expect(count("market_calls", "mode = 'REAL'")).toBe(1);
      expect(count("market_calls", "mode = 'SIMULATION'")).toBe(1);
    });

    it("reports the reach it actually achieved in each ledger", () => {
      expect(put("REAL").reached).toBe(1);
      expect(put("SIMULATION").reached).toBe(1);
    });

    it("counts table capacity per ledger", () => {
      for (let i = 0; i < 3; i++) expect(put("REAL", ME, OTHER, MARKET + i).ok).toBe(true);
      // The real table is full…
      expect(put("REAL", ME, OTHER, MARKET + 3).reason).toBe("full");
      // …and Simulation still has all three of its own slots.
      expect(put("SIMULATION", ME, OTHER, MARKET + 3).ok).toBe(true);
    });

    it("answers only the calls in the ledger the order settled in", () => {
      activate(ME);
      put("REAL", OTHER, ME);
      put("SIMULATION", OTHER, ME);
      const res = order({ wallet: ME });
      expect(res.answered).toEqual([OTHER]);
      expect(count("market_calls", "mode = 'SIMULATION' and responded_at is not null")).toBe(1);
      // The real call is untouched — a simulated position does not answer it.
      expect(count("market_calls", "mode = 'REAL' and responded_at is null")).toBe(1);
    });
  });

  /* ── 6 · Leaving ─────────────────────────────────────────────────────────── */

  describe("leaving removes this person from Simulation Challenge entirely", () => {
    const putSim = (caller: string, responder: string, market = MARKET) =>
      JSON.parse(
        sql(
          `select put_on_table(${lit(caller)}, ${market}, null,
           ${lit(JSON.stringify([{ wallet: responder, relation: "twin" }]))}::jsonb, 'SIMULATION')`,
        ),
      ) as { ok?: boolean; id?: number };

    it("closes outgoing Challenges AND removes their unanswered calls", () => {
      // Closing only the parent left the recipient rows alive, and
      // `buildChallenges` reads those directly — so other people went on being
      // asked by somebody who had left and could no longer answer.
      activate(ME);
      putSim(ME, OTHER);
      expect(count("market_calls", "mode = 'SIMULATION'")).toBe(1);

      exit_(ME);
      expect(count("challenges", "closed_at is null and mode = 'SIMULATION'")).toBe(0);
      expect(one("select close_reason from challenges")).toBe("simulation_exit");
      expect(count("market_calls", "mode = 'SIMULATION' and responded_at is null")).toBe(0);
    });

    it("removes incoming calls without recording a pass", () => {
      activate(ME);
      putSim(OTHER, ME);
      exit_(ME);
      expect(count("market_calls", "responder_wallet = " + lit(ME))).toBe(0);
      // A pass is a durable claim about a choice. Leaving is not one.
      expect(count("market_calls", "passed_at is not null")).toBe(0);
    });

    it("closes a Challenge its last recipient just left", () => {
      // Otherwise it holds one of the creator's three slots forever, asking
      // nobody — the same corpse `put_on_table` refuses to create.
      activate(ME);
      activate(OTHER);
      putSim(OTHER, ME);
      expect(count("challenges", "closed_at is null")).toBe(1);

      exit_(ME);
      expect(count("challenges", "closed_at is null")).toBe(0);
      expect(one("select close_reason from challenges")).toBe("simulation_exit");
    });

    it("leaves real Challenges completely alone", () => {
      activate(ME);
      sql(
        `select put_on_table(${lit(ME)}, ${MARKET}, null,
         ${lit(JSON.stringify([{ wallet: OTHER, relation: "twin" }]))}::jsonb, 'REAL')`,
      );
      exit_(ME);
      expect(count("challenges", "mode = 'REAL' and closed_at is null")).toBe(1);
      expect(count("market_calls", "mode = 'REAL'")).toBe(1);
    });

    it("preserves the balance, the positions and the order history", () => {
      activate();
      order({ amount: 250 });
      exit_();
      expect(Number(one("select available_balance_cc from simulation_accounts"))).toBe(START - 250);
      expect(count("simulation_positions")).toBe(1);
      expect(count("simulation_orders")).toBe(1);
      expect(one("select state from simulation_accounts")).toBe("EXITED");
    });
  });

  /* ── The immutable ledger ────────────────────────────────────────────────── */

  describe("the order ledger is append-only", () => {
    it("refuses an update or a delete", () => {
      activate();
      order();
      expect(() => sql("update simulation_orders set amount_cc = 1")).toThrow(/append-only/);
      expect(() => sql("delete from simulation_orders")).toThrow(/append-only/);
    });
  });
});
