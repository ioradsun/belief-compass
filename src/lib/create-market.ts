/**
 * On-chain "Create a market" — reads for live UI gating + a single-signature,
 * simulate-first create. Client-only (wagmi/viem), mirroring src/lib/chain-trade.ts.
 *
 * The contract is verified but UNAUDITED, so every path is defensive: the exact
 * verified ABI, live reads before submit, an imperative `simulateContract` that
 * must succeed first, exactly one signature, and the real marketId + token
 * addresses decoded from the MarketCreated receipt event (never fabricated).
 *
 * Address + chain come from src/chain (the same proxy the indexer reads).
 */
import { useState } from "react";
import { parseAbi, parseEventLogs, type Hex } from "viem";
import { useAccount, useConfig, useReadContract, useWriteContract } from "wagmi";
import { readContract, simulateContract, waitForTransactionReceipt, getBalance } from "@wagmi/core";
import { PROXY_ADDRESS, CHAIN_ID } from "@/chain/decoder";
import {
  createMarketArgs,
  checkSeed,
  checkBalance,
  DEFAULT_GAS_HEADROOM_WEI,
} from "@/domain/create-market";

/** Focused ABI fragment (verified shapes from src/chain/abi.json — do not paraphrase). */
export const CREATE_ABI = parseAbi([
  "function createMarket(string questionId, string _yesAgent, string _noAgent, address curve, bool yes) payable returns (uint256 marketId)",
  "function minSeedEth() view returns (uint256)",
  "function whitelistedCurves(address curve) view returns (bool)",
  "function questionIdToMarketId(string questionId) view returns (uint256)",
  "function nextMarketId() view returns (uint256)",
  "event MarketCreated(uint256 indexed marketId, address indexed creator, string yesAgent, string noAgent, string questionId, address yesToken, address noToken, address curve, uint256 basePrice, uint256 seedTokens, uint256 totalCost)",
]);

const CONTRACT = { address: PROXY_ADDRESS, abi: CREATE_ABI } as const;

/**
 * The bonding curve `createMarket` seeds against. It MUST be a curve the contract
 * whitelists — supplied via env, never invented, and re-verified on-chain via
 * whitelistedCurves() before every create. Undefined until configured.
 */
export const CREATE_MARKET_CURVE = ((): `0x${string}` | undefined => {
  const raw = (import.meta as { env?: Record<string, string | undefined> }).env
    ?.VITE_CONVICTION_CURVE;
  return raw && /^0x[0-9a-fA-F]{40}$/.test(raw) ? (raw.toLowerCase() as `0x${string}`) : undefined;
})();

// ── live reads for UI gating ─────────────────────────────────────────────────

/** The on-chain minimum seed (wei). Gate the stake input against this. */
export function useMinSeedEth() {
  const q = useReadContract({ ...CONTRACT, functionName: "minSeedEth", chainId: CHAIN_ID });
  return { minSeedWei: (q.data as bigint | undefined) ?? null, isLoading: q.isLoading };
}

/** Is the configured curve actually whitelisted? A create is impossible if not. */
export function useCurveWhitelisted(curve = CREATE_MARKET_CURVE) {
  const q = useReadContract({
    ...CONTRACT,
    functionName: "whitelistedCurves",
    args: curve ? [curve] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!curve },
  });
  return {
    curve,
    whitelisted: curve ? ((q.data as boolean | undefined) ?? null) : false,
    isLoading: q.isLoading,
  };
}

/** questionIdToMarketId(id) — nonzero means the id is already taken on-chain. */
export function useQuestionIdTaken(questionId: string | null) {
  const q = useReadContract({
    ...CONTRACT,
    functionName: "questionIdToMarketId",
    args: questionId ? [questionId] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: !!questionId },
  });
  const id = q.data as bigint | undefined;
  return { taken: id != null ? id > 0n : null, existingMarketId: id ?? null };
}

// ── the create mutation (single signature, simulate-first) ───────────────────

export type CreatePhase =
  | "idle"
  | "preflight" // reading min seed / curve / dupe / balance
  | "simulating" // static-call createMarket
  | "signing" // awaiting the one wallet signature
  | "confirming" // tx submitted, waiting for the receipt
  | "done"
  | "error";

export type CreateFailure =
  | "not_configured" // no whitelisted curve configured
  | "curve_not_whitelisted"
  | "duplicate_question"
  | "below_min_seed"
  | "insufficient_balance"
  | "simulation_reverted"
  | "user_rejected"
  | "no_wallet"
  | "no_event" // tx mined but MarketCreated wasn't found
  | "failed";

export interface CreateResult {
  marketId: string; // decimal string
  yesToken: `0x${string}`;
  noToken: `0x${string}`;
  txHash: `0x${string}`;
}

export interface CreateParams {
  questionId: string;
  yesAgent?: string;
  noAgent?: string;
  yes: boolean;
  seedWei: bigint;
  curve?: `0x${string}`;
}

/** True when a wallet error is the user declining/closing the request. */
function isUserRejection(err: unknown): boolean {
  const e = err as { code?: number; name?: string; message?: string; shortMessage?: string } | null;
  if (!e) return false;
  if (e.code === 4001) return true;
  const text = `${e.name ?? ""} ${e.shortMessage ?? ""} ${e.message ?? ""}`.toLowerCase();
  return text.includes("user rejected") || text.includes("user denied");
}

export class CreateMarketError extends Error {
  constructor(
    public reason: CreateFailure,
    message?: string,
  ) {
    super(message ?? reason);
    this.name = "CreateMarketError";
  }
}

export function useCreateMarket() {
  const config = useConfig();
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [phase, setPhase] = useState<CreatePhase>("idle");
  const [failure, setFailure] = useState<CreateFailure | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<CreateResult | null>(null);

  const fail = (reason: CreateFailure, e?: unknown): never => {
    setFailure(reason);
    setError(e instanceof Error ? e : new Error(reason));
    setPhase("error");
    throw e instanceof Error ? e : new CreateMarketError(reason);
  };

  async function create(params: CreateParams): Promise<CreateResult> {
    setFailure(null);
    setError(null);
    setResult(null);
    if (!address) return fail("no_wallet");
    const curve = params.curve ?? CREATE_MARKET_CURVE;
    if (!curve) return fail("not_configured");

    // 1. Preflight — read the on-chain truth in parallel; never assume it.
    setPhase("preflight");
    let minSeedWei: bigint;
    let whitelisted: boolean;
    let existingId: bigint;
    let balanceWei: bigint;
    try {
      const [minSeed, wl, dupe, bal] = await Promise.all([
        readContract(config, { ...CONTRACT, functionName: "minSeedEth", chainId: CHAIN_ID }),
        readContract(config, {
          ...CONTRACT,
          functionName: "whitelistedCurves",
          args: [curve],
          chainId: CHAIN_ID,
        }),
        readContract(config, {
          ...CONTRACT,
          functionName: "questionIdToMarketId",
          args: [params.questionId],
          chainId: CHAIN_ID,
        }),
        getBalance(config, { address, chainId: CHAIN_ID }),
      ]);
      minSeedWei = minSeed as bigint;
      whitelisted = wl as boolean;
      existingId = dupe as bigint;
      balanceWei = bal.value;
    } catch (e) {
      return fail("failed", e);
    }

    if (!whitelisted) return fail("curve_not_whitelisted");
    if (existingId > 0n) return fail("duplicate_question");
    if (!checkSeed(params.seedWei, minSeedWei).ok) return fail("below_min_seed");
    if (!checkBalance(balanceWei, params.seedWei, DEFAULT_GAS_HEADROOM_WEI).ok)
      return fail("insufficient_balance");

    const args = createMarketArgs({
      questionId: params.questionId,
      yesAgent: params.yesAgent,
      noAgent: params.noAgent,
      curve,
      yes: params.yes,
    });

    // 2. Simulate — the contract is unaudited; a static call must succeed first.
    setPhase("simulating");
    let request: Parameters<typeof writeContractAsync>[0];
    try {
      const sim = await simulateContract(config, {
        ...CONTRACT,
        functionName: "createMarket",
        args,
        value: params.seedWei,
        account: address,
        chainId: CHAIN_ID,
      });
      request = sim.request as typeof request;
    } catch (e) {
      return fail("simulation_reverted", e);
    }

    // 3. One signature.
    setPhase("signing");
    let txHash: `0x${string}`;
    try {
      txHash = await writeContractAsync(request);
    } catch (e) {
      return fail(isUserRejection(e) ? "user_rejected" : "failed", e);
    }

    // 4. Confirm + decode the real marketId / token addresses from the event.
    setPhase("confirming");
    try {
      const rcpt = await waitForTransactionReceipt(config, { hash: txHash, chainId: CHAIN_ID });
      const events = parseEventLogs({
        abi: CREATE_ABI,
        eventName: "MarketCreated",
        logs: rcpt.logs,
      });
      const evt = events[0] as { args?: Record<string, unknown> } | undefined;
      if (!evt?.args) return fail("no_event");
      const a = evt.args;
      const out: CreateResult = {
        marketId: (a.marketId as bigint).toString(),
        yesToken: a.yesToken as `0x${string}`,
        noToken: a.noToken as `0x${string}`,
        txHash,
      };
      setResult(out);
      setPhase("done");
      return out;
    } catch (e) {
      return fail("failed", e);
    }
  }

  const reset = () => {
    setPhase("idle");
    setFailure(null);
    setError(null);
    setResult(null);
  };

  return {
    create,
    phase,
    failure,
    error,
    result,
    reset,
    isBusy: phase !== "idle" && phase !== "error" && phase !== "done",
  };
}

export type { Hex };
