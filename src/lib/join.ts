/**
 * The join transaction.
 *
 * Writes to the BeliefMarket proxy through wagmi using the PINNED ABI
 * (src/chain/abi.json, fetched once at build from the verified implementation).
 * Nothing here derives value, return, or P&L — it commits capital and reports
 * the transaction state.
 */
import { useCallback, useState } from "react";
import { parseEther } from "viem";
import { useAccount, useWriteContract, usePublicClient } from "wagmi";
import { base } from "wagmi/chains";
import abi from "@/chain/abi.json" with { type: "json" };
import meta from "@/chain/abi.meta.json" with { type: "json" };
import type { SideKey } from "@/lib/contract";

export const BELIEF_MARKET_ADDRESS = meta.proxy_address as `0x${string}`;

export type JoinState =
  | { status: "idle" }
  | { status: "signing" }
  | { status: "receipt"; hash: `0x${string}` | null; amountEth: string; side: SideKey }
  | { status: "confirmed"; hash: `0x${string}`; amountEth: string; side: SideKey }
  | { status: "error"; message: string };

export function useJoin() {
  const { address, chainId } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient({ chainId: base.id });
  const [state, setState] = useState<JoinState>({ status: "idle" });

  const reset = useCallback(() => setState({ status: "idle" }), []);

  const join = useCallback(
    async (beliefId: string, side: SideKey, amountEth: string) => {
      if (!address) throw new Error("no-wallet");
      setState({ status: "signing" });
      try {
        const hash = await writeContractAsync({
          address: BELIEF_MARKET_ADDRESS,
          abi: abi as never,
          functionName: "buy",
          args: [BigInt(beliefId), side === "y", 0n],
          value: parseEther(amountEth),
          chainId: base.id,
        });
        // Optimistic receipt: the values were already quoted, so show them now.
        setState({ status: "receipt", hash, amountEth, side });
        if (publicClient) {
          await publicClient.waitForTransactionReceipt({ hash });
        }
        setState({ status: "confirmed", hash, amountEth, side });
        return hash;
      } catch (e) {
        setState({
          status: "error",
          message:
            e instanceof Error && /reject|denied/i.test(e.message)
              ? "The wallet did not sign this. Your amount is still here."
              : "That did not go through. Your amount is still here.",
        });
        return null;
      }
    },
    [address, writeContractAsync, publicClient],
  );

  return { join, state, reset, chainId };
}
