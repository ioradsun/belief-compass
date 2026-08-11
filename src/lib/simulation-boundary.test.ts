import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * THE BOUNDARY, ASSERTED CLOSED.
 *
 * Simulation's entire safety story is one sentence: same product, SEPARATE
 * ledger. Every test here is a way that sentence could quietly stop being true —
 * a simulated order reaching the contract, a CC balance landing in a real table,
 * a play position counted as market capital — and none of them would be visible
 * in the product until somebody's real money was already involved.
 *
 * Structural, because the failure mode is structural. A unit test can only prove
 * that the code as written behaves; these prove that the code CANNOT be written
 * the other way without the test going red.
 */
const code = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

/** SQL, comments stripped — these files explain themselves at length. */
const sqlOf = (p: string) =>
  readFileSync(join(process.cwd(), p), "utf8").replace(/^\s*--.*$/gm, "");

const SIM_SERVER = "src/lib/simulation.server.ts";
const SIM_FNS = "src/lib/simulation.functions.ts";
const EXECUTION = "src/lib/market-execution.ts";
const CHAIN = "src/lib/chain-trade.ts";
const MIGRATION = "supabase/migrations/20260909000000_simulation_mode.sql";

describe("no Simulation order can reach the chain", () => {
  it("never writes a contract from any Simulation path", () => {
    for (const p of [SIM_SERVER, SIM_FNS, EXECUTION]) {
      expect(code(p)).not.toMatch(/writeContractAsync|useWriteContract/);
    }
  });

  it("asks for no signature of a transaction, no gas and no network switch", () => {
    for (const p of [SIM_SERVER, SIM_FNS, EXECUTION]) {
      const c = code(p);
      expect(c).not.toMatch(/switchChain|useSwitchChain/);
      expect(c).not.toMatch(/estimateGas|maxFeePerGas|gasPrice/);
      // `sendTransaction` is the other door into a wallet spend.
      expect(c).not.toMatch(/sendTransaction/);
    }
  });

  it("leaves chain-trade real-only, with no simulation branch inside it", () => {
    const c = code(CHAIN);
    expect(c).not.toMatch(/simulat/i);
  });

  it("touches the chain only to READ a quote", () => {
    const c = code(SIM_SERVER);
    expect(c).toMatch(/readContract/);
    expect(c).toMatch(/getTokensForETH/);
    expect(c).toMatch(/getSellProceeds/);
    // A view function cannot mutate; a write function is what must never appear.
    expect(c).not.toMatch(/functionName:\s*"(buy|sell)"/);
  });
});

describe("the ledger is separate, not a flag on the real one", () => {
  it("writes only Simulation tables plus the shared belief bridge", () => {
    const c = code(SIM_SERVER);
    const REAL_TABLES = [
      "events",
      "wallet_beliefs",
      "positions",
      "trade_events",
      "market_state_snapshots",
      "conviction_trades",
    ];
    for (const t of REAL_TABLES) {
      // Reading `market_state` for a live price is fine and necessary; WRITING
      // any real financial table is the thing that must be impossible.
      expect(c).not.toMatch(new RegExp(`from\\("${t}"\\)[\\s\\S]{0,120}\\.(insert|upsert|update)`));
    }
  });

  it("never adds an is_simulation flag to a real row", () => {
    // The cheap option, and the one that eventually lies: dozens of existing
    // queries would need to learn about the flag, and the first that forgot
    // would count play balances as market capital.
    for (const c of [code(SIM_SERVER), code(SIM_FNS), sqlOf(MIGRATION)]) {
      expect(c).not.toMatch(/is_simulation/);
    }
  });

  it("keeps the CC balance out of the real display-unit system", () => {
    const money = code("src/domain/money.ts");
    const unit = code("src/lib/display-unit.tsx");
    // CC has no rate, so it cannot participate in a conversion context.
    expect(money).not.toMatch(/\bCC\b/);
    expect(money).toMatch(/export type DisplayUnit = "USD" \| "ETH"/);
    expect(unit).not.toMatch(/formatCC/);
  });

  it("formats CC with a suffix and never a currency symbol", () => {
    const c = readFileSync(join(process.cwd(), "src/domain/simulation.ts"), "utf8");
    expect(c).not.toMatch(/\$\$\{|"\$"/);
  });
});

/**
 * A WALLET ADDRESS IS PUBLIC. Anything keyed by one and not proved is readable by
 * anyone who knows it — and a CC balance, a set of simulated positions and a
 * lifecycle state are none of them things the product shows about other people.
 * "Private in V1" has to mean the server refuses, not that no screen renders it.
 */
describe("the private ledger cannot be read without proving the wallet", () => {
  const fns = code(SIM_FNS);

  /** Each private endpoint, and the handler body that answers it. */
  const handler = (name: string) => {
    const at = fns.indexOf(`export const ${name} =`);
    expect(at).toBeGreaterThan(-1);
    const rest = fns.slice(at + 1);
    const next = rest.indexOf("\nexport const ");
    return next === -1 ? rest : rest.slice(0, next);
  };

  const PRIVATE = ["getSimulationAccount", "getSimulationPositions", "getSimulationPosition"];

  it("requires a session on every private read", () => {
    for (const name of PRIVATE) {
      const h = handler(name);
      expect(h).toMatch(/session: SESSION/);
      // Not `.nullish()` or `.optional()` — a proof that may be omitted is not one.
      expect(h).not.toMatch(/session: SESSION\.(nullish|optional)/);
      expect(h).toMatch(/assertWalletOwnership/);
    }
  });

  it("reads the PROVED wallet, never the claimed one", () => {
    // `assertWalletOwnership` returns the address it verified. Passing
    // `data.wallet` on instead would make the check decorative: the request
    // could name one wallet and carry another's session.
    for (const name of PRIVATE) {
      const h = handler(name);
      expect(h).toMatch(/const wallet = await assertWalletOwnership/);
      expect(h).not.toMatch(/load\w+\(\s*data\.wallet/);
    }
  });

  it("takes a required wallet rather than a nullable one on the private reads", () => {
    // A nullish wallet forced a signed-out branch that returned data without
    // ever reaching the ownership check.
    for (const name of PRIVATE) {
      expect(handler(name)).toMatch(/wallet: WALLET,/);
    }
  });

  it("keeps the conviction count public, because it is an aggregate", () => {
    // The entry card must print a real count to a wallet that has never minted a
    // session. Requiring proof here would tell somebody with eight convictions
    // that they have none.
    const beliefs = code("src/lib/beliefs.functions.ts");
    const at = beliefs.indexOf("export const getProfileProgress");
    expect(at).toBeGreaterThan(-1);
    expect(beliefs.slice(at, at + 600)).not.toMatch(/assertWalletOwnership/);
  });

  it("never lets a read open a wallet", () => {
    // A signature prompt triggered by looking at a screen is not a read.
    const q = code("src/lib/simulation-query.ts");
    expect(q).not.toMatch(/interactive:\s*true/);
    expect(q).toMatch(/signedRead/);
  });

  it("only the order transaction may claim Simulation provenance", () => {
    // The public belief endpoint accepted `source: "simulation"`, so any caller
    // could stamp a free tap as a completed Simulation conviction.
    const beliefs = code("src/lib/beliefs.functions.ts");
    expect(beliefs).toMatch(/source: z\.enum\(\["tap", "calibration"\]\)/);
    expect(beliefs).not.toMatch(/z\.enum\(\[[^\]]*"simulation"[^\]]*\]\)/);
  });
});

describe("one definition of which markets are already answered", () => {
  it("the calibration queue excludes the same set the count is built from", () => {
    // Two definitions meant a market somebody had backed and exited was offered
    // as unanswered — and answering it left their progress unchanged, because
    // the canonical count already included it.
    const c = code("src/lib/beliefs.functions.ts");
    expect(c).toMatch(/export async function answeredMarkets/);
    const queue = c.slice(c.indexOf("export const getCalibrationQueue"));
    expect(queue).toMatch(/answeredMarkets\(sb, wallet\)/);
    expect(queue).not.toMatch(/\.in\("stance_side", \["YES", "NO"\]\)/);
  });
});

describe("the order transaction is atomic and idempotent", () => {
  it("settles or writes nothing — there is no pending order state", () => {
    const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
    expect(sql).toMatch(/status\s+text\s+NOT NULL DEFAULT 'SETTLED' CHECK \(status = 'SETTLED'\)/);
  });

  it("scopes the idempotency key to the wallet, not the whole table", () => {
    // A key is a CLIENT value. Global uniqueness means one person's key can
    // refuse another person's genuine order.
    const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
    expect(sql).toMatch(
      /simulation_orders_idempotency_idx[\s\S]{0,120}\(wallet, idempotency_key\)/,
    );
    expect(sql).not.toMatch(/idempotency_key\s+text\s+NOT NULL UNIQUE/);
  });

  it("rejects the same key carrying a different order", () => {
    const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
    expect(sql).toMatch(/request_fingerprint/);
    expect(sql).toMatch(/'idempotency_conflict'/);
  });

  it("rechecks idempotency AFTER taking the lock, not only before it", () => {
    // Both concurrent submissions miss the pre-lock check; the second must find
    // the settled row once it holds the lock, or it collides and FAILS instead
    // of replaying — the exact case the mechanism exists for.
    const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
    const fn = sql.slice(sql.indexOf("FUNCTION public.simulation_execute_order"));
    const lockAt = fn.indexOf("FOR UPDATE");
    const after = fn.slice(lockAt);
    expect(after).toMatch(/simulation_replay_order\(v_me, p_idempotency_key/);
  });

  it("can replay a settled order without any pricing read", () => {
    // A retry must not depend on an ETH/USD rate or a contract quote: an order
    // that already settled cannot be reported as failed because pricing blinked.
    const server = code(SIM_SERVER);
    const body = server.slice(server.indexOf("export async function executeSimulationOrder"));
    const replayAt = body.indexOf("simulation_replay_order");
    const rateAt = body.indexOf("readEthUsd");
    expect(replayAt).toBeGreaterThan(-1);
    expect(rateAt).toBeGreaterThan(replayAt);
    // And the replay RPC itself reads nothing but rows.
    const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
    const fn = sql.slice(
      sql.indexOf("FUNCTION public.simulation_replay_order"),
      sql.indexOf("FUNCTION public.simulation_execute_order"),
    );
    expect(fn).toMatch(/STABLE/);
  });

  it("locks the account before checking the balance", () => {
    const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
    expect(sql).toMatch(/FROM simulation_accounts WHERE wallet = v_me FOR UPDATE/);
  });

  it("re-reads eligibility inside the lock rather than trusting the caller", () => {
    const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
    expect(sql).toMatch(/v_count := simulation_conviction_count\(v_me\)/);
    expect(sql).toMatch(/IF v_count >= p_target THEN[\s\S]{0,160}'complete'/);
  });

  it("cannot go negative, and cannot re-grant the starting balance", () => {
    const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
    expect(sql).toMatch(/CHECK \(available_balance_cc >= 0\)/);
    // The ON CONFLICT branch of activation deliberately assigns no balance.
    const activate = sql.slice(sql.indexOf("simulation_activate"));
    const conflict = activate.slice(
      activate.indexOf("ON CONFLICT (wallet) DO UPDATE"),
      activate.indexOf("RETURNING * INTO v_row"),
    );
    expect(conflict).not.toMatch(/available_balance_cc/);
  });

  it("a graduated account can never reactivate", () => {
    const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
    expect(sql).toMatch(/CHECK \(\(graduated_at IS NULL\) = \(state <> 'GRADUATED'\)\)/);
    expect(sql).toMatch(/IF FOUND AND v_row\.state = 'GRADUATED' THEN[\s\S]{0,120}'graduated'/);
    // And the trigger pins it, so no writer anywhere can move it back.
    expect(sql).toMatch(/IF OLD\.state = 'GRADUATED' THEN[\s\S]{0,80}NEW\.state := 'GRADUATED'/);
  });

  it("writes GRADUATING in the same transaction as the tenth conviction", () => {
    // Derived on the client, this rule was invisible to the audience query — so
    // somebody who had finished could still be given a Challenge to answer.
    const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
    const fn = sql.slice(sql.indexOf("FUNCTION public.simulation_execute_order"));
    expect(fn).toMatch(
      /IF v_count >= p_target AND v_acct\.state = 'ACTIVE' THEN[\s\S]{0,160}state = 'GRADUATING'/,
    );
  });
});

describe("a Simulation conviction enters matching as an expressed belief", () => {
  it("writes expressed_beliefs with source = simulation, at the fixed weight", () => {
    const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
    expect(sql).toMatch(/INSERT INTO expressed_beliefs[\s\S]{0,240}'simulation'/);
    // The weight is passed in, and the server passes the CONSTANT — never the
    // amount of CC committed, which would make a free spend look like certainty.
    const server = code(SIM_SERVER);
    expect(server).toMatch(/p_weight: EXPRESSED_WEIGHT/);
    expect(server).not.toMatch(/p_weight:\s*(amountCc|input\.size)/);
  });

  it("creates no second conviction record and no second matching model", () => {
    const c = code(SIM_SERVER);
    expect(c).not.toMatch(/simulation_beliefs|simulation_matches|simulation_dna/);
    expect(c).toMatch(/request_viewer_match_refresh|simulation_execute_order/);
  });

  it("writes no belief at all from a perfectly balanced position", () => {
    const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
    // A balanced position expresses nothing, and guessing a side for it would
    // invent a belief out of the absence of one.
    expect(sql).toMatch(/IF v_dir IN \('YES','NO'\) AND \(v_new_yes > 0 OR v_new_no > 0\) THEN/);
  });
});

describe("Challenge is mode-scoped end to end", () => {
  it("stamps a mode on every social record, defaulting existing rows to REAL", () => {
    const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
    expect(sql).toMatch(
      /ALTER TABLE public\.challenges\s+ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'REAL'/,
    );
    expect(sql).toMatch(
      /ALTER TABLE public\.market_calls\s+ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'REAL'/,
    );
  });

  it("scopes table capacity by mode", () => {
    const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
    expect(sql).toMatch(
      /challenges_active_slot_idx[\s\S]{0,120}\(challenger_wallet, mode, slot_no\)/,
    );
    expect(sql).toMatch(
      /challenges_active_market_idx[\s\S]{0,120}\(challenger_wallet, mode, market_id\)/,
    );
  });

  it("intersects the Simulation audience with active Simulation users", () => {
    const c = code("src/lib/challenge.server.ts");
    expect(c).toMatch(/from\("simulation_accounts"\)[\s\S]{0,160}\.eq\("active", true\)/);
    // A narrowing, never a replacement — the relationships that qualify somebody
    // are identical in both modes.
    expect(c).toMatch(/members = members\.filter\(\(c\) => active\.has\(c\.wallet\)\)/);
  });

  it("a real position cannot close a Simulation call", () => {
    const c = code("src/lib/challenge.server.ts");
    expect(c).toMatch(/\.eq\("mode", "REAL"\)/);
  });

  it("leaving closes unresolved Simulation Challenges without recording a pass", () => {
    const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
    const exit = sql.slice(sql.indexOf("FUNCTION public.simulation_exit"));
    const body = exit.slice(0, exit.indexOf("REVOKE ALL ON FUNCTION public.simulation_exit"));
    expect(body).toMatch(/close_reason = 'simulation_exit'/);
    // `passed_at` reaches Challenge lifecycle, so it must never be set here.
    expect(body).not.toMatch(/SET[\s\S]{0,80}passed_at/);
  });
});

describe("the House rounds cannot consume each other", () => {
  it("stores the Simulation round in its own table", () => {
    const sql = readFileSync(join(process.cwd(), MIGRATION), "utf8");
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.simulation_house_rounds/);
  });

  it("never writes house_predictions from the Simulation reveal", () => {
    const c = code("src/lib/house.server.ts");
    const start = c.indexOf("export async function finalizeSimulationBet");
    expect(start).toBeGreaterThan(-1);
    // Up to the NEXT exported function, whichever it happens to be — slicing to
    // a named neighbour would silently pass if the file were ever reordered.
    const rest = c.slice(start + 1);
    const next = rest.indexOf("export async function");
    const body = next === -1 ? rest : rest.slice(0, next);
    expect(body).not.toMatch(/from\("house_predictions"\)[\s\S]{0,200}\.(update|upsert)/);
    expect(body).toMatch(/from\("simulation_house_rounds"\)/);
  });

  it("proves the reveal against a settled order rather than the client's word", () => {
    const c = code("src/lib/house.server.ts");
    expect(c).toMatch(/verifySimulationOrder/);
    const server = code(SIM_SERVER);
    // Belongs to this wallet, this market, this side, and is a buy.
    expect(server).toMatch(/row\.wallet === input\.wallet\.toLowerCase\(\)/);
    expect(server).toMatch(/Number\(row\.onchain_id\) === input\.marketId/);
    expect(server).toMatch(/row\.side === input\.side/);
    expect(server).toMatch(/row\.action === "BUY"/);
  });
});
