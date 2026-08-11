/**
 * SIMULATION — the server side of the separate ledger.
 *
 * Three things live here and nowhere else:
 *
 *   1. THE LIFECYCLE. Activate, exit, graduate — each one a single RPC, because
 *      the rules they enforce (granted once, graduated never returns, eligible
 *      only below ten) are only true if they are checked and applied inside one
 *      transaction.
 *
 *   2. THE QUOTE, RE-READ FROM BASE. The browser sends what it showed the
 *      reader; this reads the contract itself and settles against what it got
 *      back. A client-supplied share count is a client-supplied position, and a
 *      simulated ledger that can be typed into is not a simulation of anything.
 *
 *   3. VALUATION. A Simulation position stores shares and cost; what it is WORTH
 *      is derived here from the live real market price. There is no second price.
 *
 * WHAT IS NOT HERE, deliberately: no contract writes, no wallet, no gas, no
 * transaction of any kind. `chain-trade.ts` stays real-only, and the only chain
 * access in this file is a READ of a public view function.
 */
import { serviceClient } from "@/lib/supabase-clients";
import { readEthUsd } from "@/lib/eth-usd.server";
import { EXPRESSED_WEIGHT, PROFILE_TARGET, profileProgressFor } from "@/domain/beliefs";
import {
  SIMULATION_START_CC,
  modeFor,
  sharesToWei,
  simulationEligible,
  type SimulationAccount,
  type SimulationLifecycle,
  type SimulationMode,
  type SimulationPosition,
  type SimulationRouting,
} from "@/domain/simulation";
import { weiToEth } from "@/domain/money";
import { usdToWei } from "@/domain/order";
import type { ProfileProgress } from "@/domain/beliefs";

type Sb = ReturnType<typeof serviceClient>;

/* ── Row shapes ──────────────────────────────────────────────────────────── */

interface AccountRow {
  wallet: string;
  starting_balance_cc: number | string;
  available_balance_cc: number | string;
  state: string;
  activated_at: string | null;
  exited_at: string | null;
  graduated_at: string | null;
}

interface PositionRow {
  onchain_id: number | string;
  yes_shares: number | string;
  no_shares: number | string;
  yes_cost_cc: number | string;
  no_cost_cc: number | string;
  last_directional_side: string | null;
}

/**
 * PostgREST returns `numeric` as a STRING, and `Number(null)` is 0. Both of those
 * turn a missing balance into a confident zero somewhere downstream, so every
 * numeric crossing this boundary goes through one coercion.
 */
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** An unrecognised state is treated as EXITED — the option that grants nothing. */
const toState = (v: string | null | undefined): SimulationLifecycle =>
  v === "ACTIVE" || v === "GRADUATING" || v === "GRADUATED" ? v : "EXITED";

const toAccount = (r: AccountRow | null): SimulationAccount | null =>
  r
    ? {
        wallet: r.wallet,
        startingBalanceCc: num(r.starting_balance_cc),
        balanceCc: num(r.available_balance_cc),
        state: toState(r.state),
        activatedAt: r.activated_at,
        exitedAt: r.exited_at,
        graduatedAt: r.graduated_at,
      }
    : null;

const toPosition = (r: PositionRow): SimulationPosition => ({
  onchainId: Number(r.onchain_id),
  yesShares: num(r.yes_shares),
  noShares: num(r.no_shares),
  yesCostCc: num(r.yes_cost_cc),
  noCostCc: num(r.no_cost_cc),
  lastDirectionalSide:
    r.last_directional_side === "YES" ? "YES" : r.last_directional_side === "NO" ? "NO" : null,
});

/* ── State ───────────────────────────────────────────────────────────────── */

/** Everything a surface needs to know about where this wallet stands. */
export interface SimulationState {
  account: SimulationAccount | null;
  progress: ProfileProgress;
  mode: SimulationMode;
  /** May this wallet start (or continue) Simulation? */
  eligible: boolean;
}

/** Signed out there is no account, no progress and nothing to simulate. */
export const emptyState = (): SimulationState => ({
  account: null,
  progress: profileProgressFor(0),
  mode: "REAL",
  eligible: true,
});

/**
 * THE CANONICAL COUNT, read through the same SQL function the order transaction
 * uses. Two implementations of "how many convictions" — one in TypeScript for the
 * screen and one in SQL for the write — would eventually disagree about whether
 * somebody had graduated, on the screen that told them they had.
 */
async function convictionCount(sb: Sb, wallet: string): Promise<number> {
  const { data, error } = await sb.rpc("simulation_conviction_count", { p_wallet: wallet });
  if (error) throw new Error(error.message);
  return num(data);
}

/**
 * WHICH LEDGER OWNS EXECUTION — the routing fact, unsigned.
 *
 * THE ONE THING ABOUT SIMULATION THAT CANNOT REQUIRE A SIGNATURE. Everything
 * else private stays proved: the balance, the positions, every write. But the
 * application has to know which executor to offer BEFORE anybody signs anything,
 * and an app that cannot answer that has only two options — refuse to trade at
 * all, or guess. Guessing means treating an unproved state as Real Mode, which
 * hands somebody the real-money executor on the strength of a query that had not
 * come back yet.
 *
 * SO THE PAYLOAD IS THE SMALLEST THING THAT ANSWERS THE QUESTION: one lifecycle
 * state, or null. No balance, no positions, no CC, no timestamps. What it
 * discloses to somebody who guesses an address is that the address is, or once
 * was, in Simulation — materially weaker than the ledger itself, and the price
 * of being able to route execution safely.
 */
export async function loadSimulationRouting(walletRaw: string): Promise<SimulationRouting> {
  const sb = serviceClient();
  const { data } = await sb
    .from("simulation_accounts")
    .select("state")
    .eq("wallet", walletRaw.toLowerCase())
    .maybeSingle();
  const row = (data ?? null) as { state: string } | null;
  return { state: row ? toState(row.state) : null };
}

/**
 * THE PRIVATE ACCOUNT — the balance, and everything else nobody but the owner
 * may read. Signed, always.
 */
export async function loadSimulationAccount(walletRaw: string): Promise<SimulationAccount | null> {
  const sb = serviceClient();
  const { data } = await sb
    .from("simulation_accounts")
    .select("*")
    .eq("wallet", walletRaw.toLowerCase())
    .maybeSingle();
  return toAccount((data ?? null) as AccountRow | null);
}

export async function loadSimulationState(walletRaw: string | null): Promise<SimulationState> {
  if (!walletRaw) return emptyState();
  const sb = serviceClient();
  const wallet = walletRaw.toLowerCase();

  const [{ data: row }, count] = await Promise.all([
    sb.from("simulation_accounts").select("*").eq("wallet", wallet).maybeSingle(),
    convictionCount(sb, wallet),
  ]);

  const account = toAccount((row ?? null) as AccountRow | null);
  const progress = profileProgressFor(count);
  return {
    account,
    progress,
    mode: modeFor({ state: account?.state ?? null }, progress),
    eligible: simulationEligible({ progress, state: account?.state ?? null }),
  };
}

/**
 * Start simulating. Idempotent: a returning user resumes the balance and the
 * positions they left, and the starting grant is not re-applied — see the
 * `ON CONFLICT` in `simulation_activate`, which deliberately does not assign a
 * balance.
 */
export async function activateSimulation(walletRaw: string): Promise<SimulationState> {
  const sb = serviceClient();
  const wallet = walletRaw.toLowerCase();
  const { data, error } = await sb.rpc("simulation_activate", {
    p_wallet: wallet,
    p_start: SIMULATION_START_CC,
    p_target: PROFILE_TARGET,
  });
  if (error) throw new Error(error.message);
  const res = (data ?? {}) as { ok?: boolean; reason?: string };
  if (!res.ok) {
    // The two refusals a reader could actually hit say what happened; anything
    // else is a bug and reads as one rather than as a product rule.
    if (res.reason === "not_eligible")
      throw new Error("Your profile already has enough convictions.");
    if (res.reason === "graduated") throw new Error("Your Conviction profile is already ready.");
    throw new Error("We couldn't start Simulation. Try again.");
  }
  return loadSimulationState(wallet);
}

/**
 * Stop simulating. `graduate` distinguishes the two ways out, and they are
 * genuinely different: an exit is reversible and a graduation is not. Both close
 * unresolved Simulation Challenges with a neutral reason (see `simulation_exit`)
 * so nobody is left waiting on an answer that can no longer arrive.
 */
/**
 * WHAT LEAVING RETURNED, INCLUDING A GRADUATION THAT WAS REFUSED.
 *
 * A refused graduation is not an error — the server RECONCILED the account back
 * to ACTIVE and the reader is simply not finished yet. Throwing would send the
 * client down its failure path, which restores the state it captured before the
 * call: GRADUATING, the very state the server has just corrected. The refusal
 * travels as a field so the outcome and its explanation arrive together.
 */
export interface DepartureResult extends SimulationState {
  refusal: "not_complete" | null;
}

export async function exitSimulation(
  walletRaw: string,
  graduate: boolean,
): Promise<DepartureResult> {
  const sb = serviceClient();
  const wallet = walletRaw.toLowerCase();

  /**
   * TWO DOORS, TWO FUNCTIONS — and the caller's intent is a REQUEST, not a
   * permission. A boolean the client supplies cannot gate a permanent state
   * transition: `simulation_graduate` re-reads the account state and the
   * conviction count itself and refuses if either is wrong. Leaving needs no
   * conditions at all, which is exactly why the two are not one call with a
   * flag.
   */
  if (graduate) {
    const { data, error } = await sb.rpc("simulation_graduate", {
      p_wallet: wallet,
      p_target: PROFILE_TARGET,
    });
    if (error) throw new Error(error.message);
    const res = (data ?? {}) as { ok?: boolean; reason?: string };
    if (!res.ok) {
      /**
       * NOT COMPLETE IS AN OUTCOME, NOT A FAILURE. A conviction fell away after
       * GRADUATING was written, so the door is shut — and `simulation_graduate`
       * has already put the account back to ACTIVE rather than leaving it in a
       * state with no order, no graduation and no exit. The reader carries on at
       * 9 / 10. Reporting it as an error would make the client roll back to the
       * state the server just corrected.
       */
      if (res.reason === "not_complete")
        return { ...(await loadSimulationState(wallet)), refusal: "not_complete" };
      // `not_graduating` means this account was never at the door — a stale tab
      // pressing Continue. Leaving is still available and still reversible.
      if (res.reason === "not_graduating")
        throw new Error("Your profile isn't ready to finish yet.");
      throw new Error("We couldn't finish Simulation. Try again.");
    }
    return { ...(await loadSimulationState(wallet)), refusal: null };
  }

  const { error } = await sb.rpc("simulation_exit", { p_wallet: wallet });
  if (error) throw new Error(error.message);
  return { ...(await loadSimulationState(wallet)), refusal: null };
}

/* ── Positions ───────────────────────────────────────────────────────────── */

/** A Simulation holding, marked against the live real-market price. */
export interface SimulationHolding extends SimulationPosition {
  title: string | null;
  /** Live REAL market price per YES share, in USD. Null when unpriced. */
  yesPriceUsd: number | null;
  noPriceUsd: number | null;
  /** Marked value in CC. Null when the market has no readable price. */
  yesValueCc: number | null;
  noValueCc: number | null;
}

/**
 * WHAT THIS WALLET HOLDS IN SIMULATION, valued against the real market.
 *
 * The prices come from `market_state`, the same read model every real position
 * surface marks against — not from a Simulation table, because there isn't one
 * and there must not be. A market with no price yields a null value and the
 * surface shows shares; it never shows a zero.
 */
export async function loadSimulationPositions(walletRaw: string): Promise<SimulationHolding[]> {
  const sb = serviceClient();
  const wallet = walletRaw.toLowerCase();

  const { data: rows } = await sb
    .from("simulation_positions")
    .select("onchain_id, yes_shares, no_shares, yes_cost_cc, no_cost_cc, last_directional_side")
    .eq("wallet", wallet);

  const positions = ((rows ?? []) as PositionRow[])
    .map(toPosition)
    .filter((p) => p.yesShares > 0 || p.noShares > 0);
  if (positions.length === 0) return [];

  const ids = positions.map((p) => p.onchainId);
  const [{ data: state }, { data: markets }] = await Promise.all([
    sb.from("market_state").select("onchain_id, yes_price_usd, no_price_usd").in("onchain_id", ids),
    sb.from("markets").select("onchain_id, title").in("onchain_id", ids),
  ]);

  const priced = new Map<number, { yes: number | null; no: number | null }>();
  for (const s of (state ?? []) as {
    onchain_id: number | string;
    yes_price_usd: number | string | null;
    no_price_usd: number | string | null;
  }[]) {
    const yes = s.yes_price_usd == null ? null : num(s.yes_price_usd);
    const no = s.no_price_usd == null ? null : num(s.no_price_usd);
    priced.set(Number(s.onchain_id), {
      yes: yes != null && yes > 0 ? yes : null,
      no: no != null && no > 0 ? no : null,
    });
  }
  const titles = new Map<number, string | null>();
  for (const m of (markets ?? []) as { onchain_id: number | string; title: string | null }[])
    titles.set(Number(m.onchain_id), m.title);

  return positions.map((p) => {
    const px = priced.get(p.onchainId) ?? { yes: null, no: null };
    return {
      ...p,
      title: titles.get(p.onchainId) ?? null,
      yesPriceUsd: px.yes,
      noPriceUsd: px.no,
      yesValueCc: px.yes == null ? null : p.yesShares * px.yes,
      noValueCc: px.no == null ? null : p.noShares * px.no,
    };
  });
}

/** One market's Simulation holding, or null. */
export async function loadSimulationPosition(
  wallet: string,
  marketId: number,
): Promise<SimulationHolding | null> {
  const all = await loadSimulationPositions(wallet);
  return all.find((p) => p.onchainId === marketId) ?? null;
}

/* ── The quote, read from the chain ──────────────────────────────────────── */

/**
 * WHAT A SIMULATION ORDER WOULD ACTUALLY GET, read from the contract.
 *
 * The same view functions the real ticket quotes against (`getTokensForETH` /
 * `getSellProceeds`), called from the server. This is what makes a Simulation
 * position track the real market: the shares are what the market would really
 * have given, at the price it would really have given them.
 *
 * THE 1:1 CONVENTION, and it is an internal calculation convention only. A CC
 * amount is pushed through the USD quote path unchanged, so 100 CC is priced
 * exactly as a real $100 order would be. It is never an exchange rate, it never
 * reaches a screen, and nothing anywhere converts CC into money.
 */
interface Quote {
  /** Whole shares (not wei). */
  shares: number;
  /** The fee the real order would have paid, expressed in CC. */
  feeCc: number;
  /** Average execution price per share, in USD. Null when unknowable. */
  priceUsd: number | null;
}

const TRADE_VIEW_ABI = [
  {
    type: "function",
    name: "getTokensForETH",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "yes", type: "bool" },
      { name: "ethAmount", type: "uint256" },
    ],
    outputs: [
      { name: "tokenAmount", type: "uint256" },
      { name: "fee", type: "uint256" },
      { name: "refund", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getSellProceeds",
    stateMutability: "view",
    inputs: [
      { name: "marketId", type: "uint256" },
      { name: "yes", type: "bool" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

async function contract() {
  const [{ getBaseClient }, { PROXY_ADDRESS }] = await Promise.all([
    import("@/chain/client"),
    import("@/chain/decoder"),
  ]);
  return { client: getBaseClient(), address: PROXY_ADDRESS };
}

/** Thrown when the market cannot be priced. Never a fabricated share count. */
export class QuoteUnavailable extends Error {
  constructor() {
    super("We couldn't price this Simulation order. Try again.");
    this.name = "QuoteUnavailable";
  }
}

/**
 * The same idempotency key, carrying a DIFFERENT order.
 *
 * Not a retry and not a duplicate — a mistake. Replaying it would hand somebody
 * a receipt for an order they did not place, so it is refused loudly instead.
 */
export class IdempotencyConflict extends Error {
  constructor() {
    super("That order didn't match the one we already recorded. Try again.");
    this.name = "IdempotencyConflict";
  }
}

/**
 * THE ONE PRICE A SIMULATION ORDER USES — the live spot price of a share.
 *
 * NOT the bonding curve's execution quote, and that distinction is the whole
 * fix. A Simulation order moves no reserves, so pushing its notional through
 * `getTokensForETH` charged it a price impact no real order ever paid: 1000 CC
 * on a thin market filled at $16.87 a share while the market marked at $1.96,
 * and the position read −88% the instant it opened. Execution and valuation must
 * come from the SAME number, and `market_state` is the number every other
 * surface marks against.
 *
 * The chain is still the fallback, but read as a PRICE (a $1 probe) rather than
 * as a fill, so it carries no impact either.
 */
async function spotPrice(
  sb: Sb,
  marketId: number,
  yes: boolean,
  ethUsd: number,
): Promise<number | null> {
  const { data } = await sb
    .from("market_state")
    .select("yes_price_usd, no_price_usd")
    .eq("onchain_id", marketId)
    .maybeSingle();
  const row = (data ?? null) as { yes_price_usd: unknown; no_price_usd: unknown } | null;
  const stored = row == null ? 0 : num(yes ? row.yes_price_usd : row.no_price_usd);
  if (stored > 0) return stored;

  const probeWei = usdToWei(1, ethUsd);
  if (probeWei <= 0n) return null;
  const { client, address } = await contract();
  const read = (await client
    .readContract({
      address,
      abi: TRADE_VIEW_ABI,
      functionName: "getTokensForETH",
      args: [BigInt(marketId), yes, probeWei],
    })
    .catch(() => null)) as readonly [bigint, bigint, bigint] | null;
  if (!read) return null;
  const shares = weiToEth(read[0]);
  return shares > 0 ? 1 / shares : null;
}

async function quoteBuy(sb: Sb, marketId: number, yes: boolean, amountCc: number, ethUsd: number) {
  const price = await spotPrice(sb, marketId, yes, ethUsd);
  if (price == null || !(price > 0)) throw new QuoteUnavailable();
  const shares = amountCc / price;
  if (!(shares > 0)) throw new QuoteUnavailable();
  // No fee: a Simulation order pays no gas and no protocol fee, and charging a
  // fabricated one would make the position open below what it is marked at.
  return { shares, feeCc: 0, priceUsd: price } satisfies Quote;
}

async function quoteSell(sb: Sb, marketId: number, yes: boolean, shares: number, ethUsd: number) {
  if (!(shares > 0)) throw new QuoteUnavailable();
  const price = await spotPrice(sb, marketId, yes, ethUsd);
  if (price == null || !(price > 0)) throw new QuoteUnavailable();
  return { proceedsCc: shares * price, priceUsd: price };
}


/* ── The order ───────────────────────────────────────────────────────────── */

export interface SimulationOrderResult {
  account: SimulationAccount;
  position: SimulationPosition;
  progress: ProfileProgress;
  mode: SimulationMode;
  order: {
    id: number;
    side: "YES" | "NO";
    action: "BUY" | "SELL";
    amountCc: number;
    shares: number;
    feeCc: number;
    priceUsd: number | null;
  };
  /** Simulation callers this order just answered. */
  answered: string[];
}

/**
 * Place a Simulation order.
 *
 * The server owns the quote and the settlement; the RPC owns eligibility, the
 * balance, the ledger, the position, the belief, the match refresh and the
 * answered calls — all in one transaction. Nothing here writes to a real table
 * and nothing here touches a wallet.
 */
/**
 * THE ORDER'S OWN IDENTITY, as one string.
 *
 * Paired with the idempotency key so a reused key carrying a DIFFERENT order is
 * refused rather than replayed. The size is rounded to six places because a
 * retry re-derives it from the same inputs and floating-point noise in the
 * fifteenth digit is not somebody changing their mind.
 */
const fingerprint = (i: { marketId: number; side: string; action: string; size: number }): string =>
  `${i.marketId}:${i.side}:${i.action}:${i.size.toFixed(6)}`;

/** The server's own shape for whatever the two order RPCs return. */
interface OrderRpcResult {
  ok?: boolean;
  reason?: string;
  available?: number | string;
  order?: Record<string, unknown>;
  account?: AccountRow;
  position?: PositionRow;
  convictions?: number | string;
  answered?: string[];
}

export async function executeSimulationOrder(input: {
  wallet: string;
  marketId: number;
  side: "YES" | "NO";
  action: "BUY" | "SELL";
  /** BUY: CC to commit. SELL: shares to sell. */
  size: number;
  idempotencyKey: string;
}): Promise<SimulationOrderResult> {
  const sb = serviceClient();
  const wallet = input.wallet.toLowerCase();
  const yes = input.side === "YES";
  const print = fingerprint(input);

  /**
   * AN ALREADY-SETTLED ORDER IS ANSWERED BEFORE ANYTHING ELSE IS ATTEMPTED.
   *
   * The pricing reads below reach the ETH/USD cache and then the Base RPC, and
   * both can be unavailable. Without this fast path a RETRY of an order that
   * already settled could fail on a quote — telling somebody their order did not
   * go through, about an order that did, and inviting them to place it again. A
   * replay must depend on nothing but the row.
   */
  const replay = await sb.rpc("simulation_replay_order", {
    p_wallet: wallet,
    p_idempotency_key: input.idempotencyKey,
    p_fingerprint: print,
  });
  if (!replay.error) {
    const settled = (replay.data ?? {}) as OrderRpcResult;
    if (settled.ok) return shapeOrderResult(settled, input.side, input.action);
    if (settled.reason === "idempotency_conflict") throw new IdempotencyConflict();
  }

  const ethUsd = await readEthUsd(sb);
  if (ethUsd == null || !(ethUsd > 0)) throw new QuoteUnavailable();

  let amountCc: number;
  let shareDelta: number;
  let feeCc = 0;
  let priceUsd: number | null = null;

  if (input.action === "BUY") {
    const q = await quoteBuy(sb, input.marketId, yes, input.size, ethUsd);
    amountCc = input.size;
    shareDelta = q.shares;
    feeCc = q.feeCc;
    priceUsd = q.priceUsd;
  } else {
    const q = await quoteSell(sb, input.marketId, yes, input.size, ethUsd);
    amountCc = q.proceedsCc;
    shareDelta = input.size;
    priceUsd = q.priceUsd;
  }

  const { data, error } = await sb.rpc("simulation_execute_order", {
    p_wallet: wallet,
    p_market_id: input.marketId,
    p_side: input.side,
    p_action: input.action,
    p_amount_cc: amountCc,
    p_share_delta: shareDelta,
    p_price_usd: priceUsd,
    p_fee_cc: feeCc,
    p_idempotency_key: input.idempotencyKey,
    // The FIXED expressed-belief weight, not the amount committed. CC is free, so
    // a large simulated position must not look like a stronger belief than a
    // small one — and neither may outrank a real position on the same market.
    p_weight: EXPRESSED_WEIGHT,
    p_target: PROFILE_TARGET,
    p_fingerprint: print,
  });
  if (error) throw new Error(error.message);

  const res = (data ?? {}) as OrderRpcResult;

  if (!res.ok) {
    const { insufficientCc } = await import("@/domain/simulation");
    if (res.reason === "insufficient_cc") throw new Error(insufficientCc(num(res.available)));
    if (res.reason === "insufficient_shares") throw new Error("You don't hold that many shares.");
    if (res.reason === "complete") throw new Error("Your Conviction profile is already ready.");
    if (res.reason === "inactive") throw new Error("Simulation isn't active for this wallet.");
    if (res.reason === "idempotency_conflict") throw new IdempotencyConflict();
    const { ORDER_FAILED } = await import("@/domain/simulation");
    throw new Error(ORDER_FAILED);
  }

  return shapeOrderResult(res, input.side, input.action);
}

/**
 * ONE SHAPE FOR BOTH DOORS. A replayed order and a freshly settled one must be
 * indistinguishable to the caller — if they were not, a retry would render a
 * different receipt from the original, which is exactly the confusion
 * idempotency exists to prevent.
 */
function shapeOrderResult(
  res: OrderRpcResult,
  side: "YES" | "NO",
  action: "BUY" | "SELL",
): SimulationOrderResult {
  const account = toAccount((res.account ?? null) as AccountRow | null);
  const position = res.position ? toPosition(res.position) : null;
  if (!account || !position) throw new Error("That Simulation order did not settle cleanly.");

  const progress = profileProgressFor(num(res.convictions));
  const row = (res.order ?? {}) as Record<string, unknown>;
  const price = row.market_price_usd == null ? null : num(row.market_price_usd);
  return {
    account,
    position,
    progress,
    mode: modeFor({ state: account.state }, progress),
    order: {
      id: Number(row.id ?? 0),
      side,
      action,
      amountCc: num(row.amount_cc),
      shares: Math.abs(num(row.share_delta)),
      feeCc: num(row.simulated_fee_cc),
      priceUsd: price != null && price > 0 ? price : null,
    },
    answered: Array.isArray(res.answered) ? res.answered.map(String) : [],
  };
}

/**
 * PROVE A SIMULATION REVEAL, the way a mined transaction proves a real one.
 *
 * The real House reveal verifies a transaction hash on Base. A Simulation order
 * has no hash, so the settled order ID is the proof — and it is checked, not
 * taken on the client's word: the order must exist, belong to this wallet, be on
 * this market and this side, and be a buy.
 */
export async function verifySimulationOrder(input: {
  wallet: string;
  marketId: number;
  side: "YES" | "NO";
  orderId: number;
}): Promise<boolean> {
  const sb = serviceClient();
  const { data } = await sb
    .from("simulation_orders")
    .select("id, wallet, onchain_id, side, action")
    .eq("id", input.orderId)
    .maybeSingle();
  const row = (data ?? null) as {
    wallet: string;
    onchain_id: number | string;
    side: string;
    action: string;
  } | null;
  return (
    !!row &&
    row.wallet === input.wallet.toLowerCase() &&
    Number(row.onchain_id) === input.marketId &&
    row.side === input.side &&
    row.action === "BUY"
  );
}
