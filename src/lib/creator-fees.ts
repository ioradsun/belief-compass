/**
 * Creator fee claims — every belief market pays its creator a share of trade
 * fees, held on the contract until the creator withdraws. This is the read +
 * claim surface for that balance (plus the referral pot, which works the same
 * way).
 *
 * Contract truth only: `creatorFees(address)` / `referralFees(address)` are the
 * escrowed amounts, and `claimCreatorFees()` / `claimReferralFees()` sweep them
 * to the caller. The claim always pays msg.sender, so it must be signed by the
 * wallet that created the markets — no delegation, no app-side accounting.
 */
import { useState } from "react";
import { parseAbi } from "viem";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { PROXY_ADDRESS, CHAIN_ID } from "@/chain/decoder";
import { isUserRejection } from "@/lib/chain-trade";

export const FEES_ABI = parseAbi([
  "function creatorFees(address) view returns (uint256)",
  "function referralFees(address) view returns (uint256)",
  "function creatorFeesPerMarket(uint256) view returns (uint256)",
  "function claimCreatorFees()",
  "function claimReferralFees()",
]);

const CONTRACT = { address: PROXY_ADDRESS, abi: FEES_ABI } as const;

/** Escrowed, unclaimed balances for a wallet (wei). */
export function useFeeBalances(wallet?: `0x${string}`) {
  const enabled = Boolean(wallet);
  const creator = useReadContract({
    ...CONTRACT,
    functionName: "creatorFees",
    args: wallet ? [wallet] : undefined,
    chainId: CHAIN_ID,
    query: { enabled, refetchInterval: 30_000 },
  });
  const referral = useReadContract({
    ...CONTRACT,
    functionName: "referralFees",
    args: wallet ? [wallet] : undefined,
    chainId: CHAIN_ID,
    query: { enabled, refetchInterval: 30_000 },
  });
  return {
    creator: (creator.data as bigint | undefined) ?? null,
    referral: (referral.data as bigint | undefined) ?? null,
    isLoading: creator.isLoading || referral.isLoading,
    error: creator.error ?? referral.error ?? null,
    refetch: async () => {
      await Promise.all([creator.refetch(), referral.refetch()]);
    },
  };
}

/** Fees earned so far by a single market (wei) — lifetime, not unclaimed. */
export function useMarketCreatorFees(marketId: number | null) {
  const q = useReadContract({
    ...CONTRACT,
    functionName: "creatorFeesPerMarket",
    args: marketId != null ? [BigInt(marketId)] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: marketId != null },
  });
  return { fees: (q.data as bigint | undefined) ?? null, isLoading: q.isLoading };
}

type ClaimKind = "creator" | "referral";

/** Sends the claim from the connected wallet and tracks it to a receipt. */
export function useClaimFees() {
  const { address } = useAccount();
  const { writeContractAsync, reset } = useWriteContract();
  const [pending, setPending] = useState<ClaimKind | null>(null);
  const [hash, setHash] = useState<`0x${string}` | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const receipt = useWaitForTransactionReceipt({ hash, chainId: CHAIN_ID });

  async function claim(kind: ClaimKind) {
    if (!address) return;
    setError(null);
    setPending(kind);
    setHash(undefined);
    try {
      const h = await writeContractAsync({
        ...CONTRACT,
        functionName: kind === "creator" ? "claimCreatorFees" : "claimReferralFees",
        chainId: CHAIN_ID,
      });
      setHash(h);
    } catch (e) {
      setError(
        isUserRejection(e)
          ? new Error("Signature declined — nothing was sent.")
          : e instanceof Error
            ? e
            : new Error("Claim failed."),
      );
      reset();
    } finally {
      setPending(null);
    }
  }

  return {
    claim,
    pending,
    hash,
    isMining: receipt.isLoading,
    isSuccess: receipt.isSuccess,
    error: error ?? receipt.error ?? null,
    clear: () => {
      setHash(undefined);
      setError(null);
      reset();
    },
  };
}
