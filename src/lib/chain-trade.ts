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
import { useEffect, useRef, useState } from "react";
import { parseAbi } from "viem";
import {
  useAccount,
  useChainId,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { PROXY_ADDRESS, CHAIN_ID } from "@/chain/decoder";
import { CONVICTION_TAG } from "@/chain/attribution";
import { minOut } from "@/domain/order";
import { writePending, readPending, clearPending } from "@/lib/pending-trade";
import { recordConvictionTrade } from "@/lib/conviction-trades.functions";

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
/** True when a wallet error is the user declining/closing the request. */
export function isUserRejection(err: unknown): boolean {
  const e = err as { code?: number; name?: string; message?: string; shortMessage?: string } | null;
  if (!e) return false;
  if (e.code === 4001) return true;
  const text = `${e.name ?? ""} ${e.shortMessage ?? ""} ${e.message ?? ""}`.toLowerCase();
  return (
    text.includes("user rejected") ||
    text.includes("user denied") ||
    text.includes("rejected the request") ||
    text.includes("userrejectedrequest")
  );
}

/** What we tag a submitted transaction with, for /value attribution. */
type TradeMeta = { marketId: number; side: "YES" | "NO"; action: "BUY" | "SELL" };

/**
 * Record that THIS app sent the transaction — the only moment that fact exists
 * (the contract takes no referrer, so on-chain it is invisible). Fire-and-forget
 * by design: attribution must never block, slow, or fail a trade, so a failed
 * record is simply a trade /value won't count.
 */
function tagConvictionTrade(txHash: string, wallet: string | undefined, meta: TradeMeta) {
  if (!wallet) return;
  void recordConvictionTrade({
    data: {
      txHash,
      wallet,
      marketId: meta.marketId,
      side: meta.side,
      action: meta.action,
      chainId: CHAIN_ID,
    },
  }).catch(() => {});
}

export function useTrade() {
  const { address } = useAccount();
  const { writeContractAsync, isPending, error, reset } = useWriteContract();
  const [hash, setHash] = useState<`0x${string}` | undefined>(undefined);
  /**
   * SYNCHRONOUS RE-ENTRY LATCH.
   *
   * `submitting` below is React state, and React state updates are async: two
   * taps inside one frame both read it as false and both reach
   * `writeContractAsync`. The call sites guard on the same async flags, so the
   * guard has the same hole. A ref is written and read in the same tick, which
   * is the only thing that actually closes it — an on-chain duplicate is
   * irreversible, so this cannot be left to a re-render.
   */
  const inFlight = useRef(false);
  // Own submit flag: some wallets (smart-wallet popups) never settle wagmi's
  // isPending if the window is dismissed, which would freeze the dock forever.
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<Error | null>(null);
  const receipt = useWaitForTransactionReceipt({ hash, chainId: CHAIN_ID });

  async function send(fn: () => Promise<`0x${string}`>, meta: TradeMeta) {
    if (inFlight.current) throw new Error("A transaction is already being submitted.");
    inFlight.current = true;
    setLocalError(null);
    setSubmitting(true);
    try {
      const h = await fn();
      setHash(h);
      // Persist BEFORE anything can unmount us. A refresh between the hash
      // arriving and this line is exactly the window that produced duplicate
      // signatures, so nothing may sit between them.
      if (address) {
        writePending({
          hash: h,
          wallet: address.toLowerCase(),
          marketId: meta.marketId,
          side: meta.side,
          action: meta.action,
          submittedAt: Date.now(),
        });
      }
      // Tag at submit time, before the block lands: /value requires the record to
      // predate the block, which is what stops a replayed public hash counting.
      tagConvictionTrade(h, address, meta);
      return h;
    } catch (e) {
      setLocalError(
        isUserRejection(e)
          ? new Error("Signature declined — nothing was sent.")
          : e instanceof Error
            ? e
            : new Error("Transaction failed."),
      );
      reset();
      throw e;
    } finally {
      setSubmitting(false);
      inFlight.current = false;
    }
  }

  async function buy(marketId: number, yes: boolean, ethWei: bigint, quotedTokens: bigint) {
    return send(
      () =>
        writeContractAsync({
          ...CONTRACT,
          functionName: "buy",
          args: [BigInt(marketId), yes, minOut(quotedTokens)],
          value: ethWei,
          chainId: CHAIN_ID,
          // Appended to the calldata; the contract ignores trailing bytes. Makes
          // this trade attributable to Conviction from public chain data alone.
          dataSuffix: CONVICTION_TAG,
        }),
      { marketId, side: yes ? "YES" : "NO", action: "BUY" },
    );
  }

  async function sell(marketId: number, yes: boolean, tokenAmount: bigint, quotedProceeds: bigint) {
    return send(
      () =>
        writeContractAsync({
          ...CONTRACT,
          functionName: "sell",
          args: [BigInt(marketId), yes, tokenAmount, minOut(quotedProceeds)],
          chainId: CHAIN_ID,
          dataSuffix: CONVICTION_TAG,
        }),
      { marketId, side: yes ? "YES" : "NO", action: "SELL" },
    );
  }

  /**
   * RESUME A TRANSACTION THE PAGE FORGOT.
   *
   * On mount, adopt any stored hash belonging to this wallet so
   * `useWaitForTransactionReceipt` picks up where the previous page left off.
   * This is the half of the fix that matters: persisting was pointless if
   * nothing read it back.
   */
  useEffect(() => {
    if (hash || !address) return;
    const stored = readPending();
    if (stored && stored.wallet === address.toLowerCase()) {
      setHash(stored.hash as `0x${string}`);
    }
  }, [address, hash]);

  /**
   * The record is cleared ONLY when the chain has answered — success or
   * revert. A timeout must never clear it: "we stopped waiting" and "it did not
   * happen" are different facts, and conflating them is what puts a reader back
   * in front of a button that can submit the same trade again.
   */
  useEffect(() => {
    if (receipt.isSuccess || receipt.isError) clearPending();
  }, [receipt.isSuccess, receipt.isError]);

  const combinedError = localError ?? error ?? receipt.error ?? null;

  return {
    buy,
    sell,
    hash,
    isSubmitting: submitting || (isPending && !localError),
    isMining: receipt.isLoading,
    isSuccess: receipt.isSuccess,
    isError: !!combinedError || receipt.isError,
    error: combinedError,
    /**
     * Dismiss a transaction the reader has decided about. Clears the stored
     * record too — this is the deliberate act that resolves an `unresolved`
     * one, and the only thing that should.
     */
    reset: () => {
      setHash(undefined);
      setLocalError(null);
      setSubmitting(false);
      inFlight.current = false;
      clearPending();
      reset();
    },
  };
}
