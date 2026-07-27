/**
 * On-chain trading — quotes + buy/sell against the pinned belief-market contract.
 *
 * Client-only (wagmi hooks). Quotes come from the contract's own view functions
 * (getTokensForETH / getSellProceeds) — no price math in the app. Writes go
 * through the contract's buy()/sell() with slippage floors. Every caller must be
 * connected and on Base; the deck enforces that before enabling Confirm.
 *
 * Source of truth for address + chain: src/chain (same pin the indexer reads).
 */
import { useState } from "react";
import { parseAbi } from "viem";
import {
  useAccount,
  useChainId,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { PROXY_ADDRESS, CHAIN_ID } from "@/chain/decoder";
import { minOut } from "@/domain/order";

export const TRADE_ABI = parseAbi([
  "function buy(uint256 marketId, bool yes, uint256 minTokens) payable",
  "function sell(uint256 marketId, bool yes, uint256 amount, uint256 minProceeds)",
  "function getTokensForETH(uint256 marketId, bool yes, uint256 ethAmount) view returns (uint256 tokenAmount, uint256 fee, uint256 refund)",
  "function getSellProceeds(uint256 marketId, bool yes, uint256 amount) view returns (uint256)",
  "function getUserBalance(uint256 marketId, address user) view returns (uint256 yesBalance, uint256 noBalance)",
]);

const CONTRACT = { address: PROXY_ADDRESS, abi: TRADE_ABI } as const;

/** True once a wallet is connected AND on Base — required before any Confirm. */
export function useTradeReady(): { connected: boolean; onBase: boolean; address?: `0x${string}` } {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  return { connected: isConnected, onBase: chainId === CHAIN_ID, address };
}

export interface BuyQuote {
  tokens: bigint;
  fee: bigint;
  refund: bigint;
}

/** On-chain buy quote: shares you'd receive for `ethWei` on the given side. */
export function useBuyQuote(marketId: number | null, yes: boolean, ethWei: bigint) {
  const q = useReadContract({
    ...CONTRACT,
    functionName: "getTokensForETH",
    args: marketId != null ? [BigInt(marketId), yes, ethWei] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: marketId != null && ethWei > 0n },
  });
  const data = q.data as readonly [bigint, bigint, bigint] | undefined;
  const quote: BuyQuote | null = data ? { tokens: data[0], fee: data[1], refund: data[2] } : null;
  return { quote, isLoading: q.isLoading, error: q.error };
}

/** On-chain sell quote: ETH you'd receive for selling `tokenAmount` shares. */
export function useSellQuote(marketId: number | null, yes: boolean, tokenAmount: bigint) {
  const q = useReadContract({
    ...CONTRACT,
    functionName: "getSellProceeds",
    args: marketId != null ? [BigInt(marketId), yes, tokenAmount] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: marketId != null && tokenAmount > 0n },
  });
  return {
    proceeds: (q.data as bigint | undefined) ?? null,
    isLoading: q.isLoading,
    error: q.error,
  };
}

/** The connected wallet's current YES/NO share balances for a market. */
export function useUserBalance(marketId: number | null) {
  const { address } = useAccount();
  const q = useReadContract({
    ...CONTRACT,
    functionName: "getUserBalance",
    args: marketId != null && address ? [BigInt(marketId), address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: marketId != null && !!address },
  });
  const d = q.data as readonly [bigint, bigint] | undefined;
  return { yes: d?.[0] ?? 0n, no: d?.[1] ?? 0n, refetch: q.refetch };
}

/**
 * Buy/sell executor. `buy` sends ETH as value with a minTokens floor derived
 * from the quote; `sell` floors proceeds. Never called except from an explicit
 * Confirm press. Returns the tx hash + a receipt-tracking status.
 */
export function useTrade() {
  const { writeContractAsync, isPending, error, reset } = useWriteContract();
  const [hash, setHash] = useState<`0x${string}` | undefined>(undefined);
  const receipt = useWaitForTransactionReceipt({ hash, chainId: CHAIN_ID });

  async function buy(marketId: number, yes: boolean, ethWei: bigint, quotedTokens: bigint) {
    const h = await writeContractAsync({
      ...CONTRACT,
      functionName: "buy",
      args: [BigInt(marketId), yes, minOut(quotedTokens)],
      value: ethWei,
      chainId: CHAIN_ID,
    });
    setHash(h);
    return h;
  }

  async function sell(marketId: number, yes: boolean, tokenAmount: bigint, quotedProceeds: bigint) {
    const h = await writeContractAsync({
      ...CONTRACT,
      functionName: "sell",
      args: [BigInt(marketId), yes, tokenAmount, minOut(quotedProceeds)],
      chainId: CHAIN_ID,
    });
    setHash(h);
    return h;
  }

  return {
    buy,
    sell,
    hash,
    isSubmitting: isPending,
    isMining: receipt.isLoading,
    isSuccess: receipt.isSuccess,
    isError: !!error || receipt.isError,
    error: error ?? receipt.error ?? null,
    reset: () => {
      setHash(undefined);
      reset();
    },
  };
}
