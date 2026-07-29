/**
 * createMarket — the one on-chain write that mints a new belief market.
 *
 * Everything here reads from the committed, verified ABI (src/chain/abi.json).
 * Nothing about the economics is hardcoded: the minimum seed, the fee split and
 * the curve whitelist are read from the contract at runtime, and the real
 * marketId/token addresses come from decoding the MarketCreated receipt log.
 *
 * The contract is verified but NOT audited — every send is simulated first.
 */
import { useCallback, useState } from "react";
import { decodeEventLog, type Abi, type TransactionReceipt } from "viem";
import {
  useAccount,
  useBalance,
  usePublicClient,
  useReadContract,
  useWriteContract,
} from "wagmi";
import abi from "./abi.json" with { type: "json" };
import { PROXY_ADDRESS, CHAIN_ID } from "./decoder";

const ABI = abi as unknown as Abi;
const CONTRACT = { address: PROXY_ADDRESS, abi: ABI } as const;

/**
 * The bonding curve POV itself uses for every market on this contract
 * (verified on-chain across markets 1, 2, 50 and the newest 30). Still checked
 * against whitelistedCurves() before we submit — never assumed.
 */
export const DEFAULT_CURVE = "0x06A6a243b2202397180295963Fde3163b4F85228" as `0x${string}`;

/**
 * yesAgent/noAgent are agent identifier STRINGS (POV passes its AI-agent
 * UUIDs), not addresses. We pin one real, existing agent pair so Conviction
 * markets carry the same shape as POV's and agent fees have a valid recipient.
 */
export const YES_AGENT = "79a5cb85-824d-4c51-a9de-ed8276cfe33a";
export const NO_AGENT = "1f6f0306-6db1-44e1-82dc-768783090c93";

export interface CreateEconomics {
  /** Minimum seed the contract accepts, in wei. */
  minSeedWei: bigint | null;
  /** Trade fee in bps (contract-wide). */
  feeBps: number | null;
  /** Creator's share of the trade fee, in bps of notional (e.g. 450 = 4.5%). */
  creatorFeeBps: number | null;
  isLoading: boolean;
}

/** Live economics: minimum seed + the creator's real cut. Never hardcoded. */
export function useCreateEconomics(): CreateEconomics {
  const min = useReadContract({ ...CONTRACT, functionName: "minSeedEth", chainId: CHAIN_ID });
  const fee = useReadContract({ ...CONTRACT, functionName: "feeBps", chainId: CHAIN_ID });
  const share = useReadContract({
    ...CONTRACT,
    functionName: "CREATOR_FEE_SHARE",
    chainId: CHAIN_ID,
  });
  const denom = useReadContract({
    ...CONTRACT,
    functionName: "FEE_DENOMINATOR",
    chainId: CHAIN_ID,
  });
  const feeBps = fee.data != null ? Number(fee.data as bigint) : null;
  const creatorFeeBps =
    feeBps != null && share.data != null && denom.data != null && Number(denom.data) > 0
      ? (feeBps * Number(share.data as bigint)) / Number(denom.data as bigint)
      : null;
  return {
    minSeedWei: (min.data as bigint | undefined) ?? null,
    feeBps,
    creatorFeeBps,
    isLoading: min.isLoading || fee.isLoading || share.isLoading || denom.isLoading,
  };
}

/** The connected wallet's spendable ETH on Base. */
export function useEthBalance() {
  const { address } = useAccount();
  const q = useBalance({
    address,
    chainId: CHAIN_ID,
    query: { enabled: !!address, refetchInterval: 20_000 },
  });
  return { wei: q.data?.value ?? null, isLoading: q.isLoading };
}

/**
 * Estimated opening shares. getTokensForETH needs an existing marketId, so
 * before creation we quote off the curve's own base price — always surfaced to
 * the user as "estimated" and replaced with the decoded seedTokens after the
 * receipt lands.
 */
export function useEstimatedOpeningShares(seedWei: bigint, feeBps: number | null) {
  const base = useReadContract({
    address: DEFAULT_CURVE,
    abi: [
      {
        type: "function",
        name: "basePrice",
        stateMutability: "view",
        inputs: [],
        outputs: [{ type: "uint256" }],
      },
    ] as const,
    functionName: "basePrice",
    chainId: CHAIN_ID,
    query: { retry: false },
  });
  const price = (base.data as bigint | undefined) ?? 1_000_000_000_000_000n; // 0.001 ETH default base
  if (seedWei <= 0n || price <= 0n) return null;
  const net = feeBps != null ? (seedWei * BigInt(10_000 - feeBps)) / 10_000n : seedWei;
  return Number(net) / Number(price);
}

export interface CreateResult {
  marketId: number;
  yesToken: `0x${string}`;
  noToken: `0x${string}`;
  seedTokens: bigint;
  txHash: `0x${string}`;
}

export interface CreateArgs {
  questionId: string;
  yes: boolean;
  seedWei: bigint;
  curve?: `0x${string}`;
}

/** Decode the real marketId + token addresses out of the MarketCreated log. */
export function decodeCreated(receipt: TransactionReceipt): Omit<CreateResult, "txHash"> | null {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== PROXY_ADDRESS.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: ABI, data: log.data, topics: log.topics });
      if (ev.eventName !== "MarketCreated") continue;
      const a = ev.args as unknown as {
        marketId: bigint;
        yesToken: `0x${string}`;
        noToken: `0x${string}`;
        seedTokens: bigint;
      };
      return {
        marketId: Number(a.marketId),
        yesToken: a.yesToken,
        noToken: a.noToken,
        seedTokens: a.seedTokens,
      };
    } catch {
      /* not our event */
    }
  }
  return null;
}

type Phase = "idle" | "checking" | "signing" | "confirming" | "done" | "error";

/**
 * One signature, fully pre-flighted: curve whitelist, duplicate questionId,
 * minimum seed, balance, then simulate — and only then ask the wallet.
 */
export function useCreateMarket() {
  const client = usePublicClient({ chainId: CHAIN_ID });
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(
    async ({ questionId, yes, seedWei, curve = DEFAULT_CURVE }: CreateArgs) => {
      if (!client) throw new Error("No Base connection.");
      if (!address) throw new Error("Connect a wallet first.");
      setError(null);
      setPhase("checking");
      try {
        const [minSeed, whitelisted, existing, balance] = await Promise.all([
          client.readContract({ ...CONTRACT, functionName: "minSeedEth" }) as Promise<bigint>,
          client.readContract({
            ...CONTRACT,
            functionName: "whitelistedCurves",
            args: [curve],
          }) as Promise<boolean>,
          client.readContract({
            ...CONTRACT,
            functionName: "questionIdToMarketId",
            args: [questionId],
          }) as Promise<bigint>,
          client.getBalance({ address }),
        ]);
        if (!whitelisted) throw new Error("That bonding curve isn't whitelisted on the contract.");
        if (existing !== 0n) throw new Error("That question ID is already taken on-chain.");
        if (seedWei < minSeed) {
          throw new Error(`Seed must be at least ${Number(minSeed) / 1e18} ETH.`);
        }
        if (balance < seedWei) throw new Error("Insufficient balance for this seed.");

        // Unaudited contract: never send without a successful simulation.
        await client.simulateContract({
          ...CONTRACT,
          functionName: "createMarket",
          args: [questionId, YES_AGENT, NO_AGENT, curve, yes],
          value: seedWei,
          account: address,
        });

        setPhase("signing");
        const hash = await writeContractAsync({
          ...CONTRACT,
          functionName: "createMarket",
          args: [questionId, YES_AGENT, NO_AGENT, curve, yes],
          value: seedWei,
          chainId: CHAIN_ID,
        });

        setPhase("confirming");
        const receipt = await client.waitForTransactionReceipt({ hash });
        if (receipt.status !== "success") throw new Error("The transaction reverted on-chain.");
        const decoded = decodeCreated(receipt);
        if (!decoded) throw new Error("Created, but the MarketCreated event could not be read.");
        setPhase("done");
        return { ...decoded, txHash: hash } satisfies CreateResult;
      } catch (e) {
        setPhase("error");
        const msg =
          e instanceof Error ? e.message.split("\n")[0] : "Could not create the market.";
        setError(msg);
        throw e;
      }
    },
    [address, client, writeContractAsync],
  );

  return { create, phase, error, reset: () => (setPhase("idle"), setError(null)) };
}
