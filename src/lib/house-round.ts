/**
 * The House round — cache key + finalize mutations.
 *
 * Extracted from the (now removed) MarketIntelligence container so the deck, the
 * mobile game and TheHouse can share the round logic without pulling a large
 * unused UI tree into the bundle.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  finalizeBet,
  finalizePass,
  recordFoundation,
  type HouseReadView,
} from "@/lib/house.functions";
import { useEffectiveWallet } from "@/hooks/useEffectiveWallet";
import { bestEffort, useWalletSession } from "@/hooks/useWalletSession";

export const houseKey = (wallet: string | undefined, marketId: number) =>
  ["house", wallet ?? null, marketId] as const;

/**
 * Finalize the round. A verified BET reveals the House pick; a PASS closes the
 * round but keeps the pick sealed. Both refresh the locked read in the cache.
 */
export function useHouseFinalize(marketId: number, viewerWallet?: string) {
  const connected = useEffectiveWallet();
  const wallet = viewerWallet ?? connected;
  const { ensureSession } = useWalletSession();
  const qc = useQueryClient();
  const store = (data: HouseReadView | null) => {
    if (data) qc.setQueryData(houseKey(wallet, marketId), data);
  };
  // A confirmed decision (buy or pass) removes this market from discovery, so the
  // feed must refresh immediately — not on the next 8s poll — and never show the
  // decided market again.
  const onDecided = (data: HouseReadView | null) => {
    store(data);
    void qc.invalidateQueries({ queryKey: ["opp-feed"] });
  };
  const bet = useMutation({
    mutationFn: async (vars: { side: "YES" | "NO"; txHash: string }) => {
      if (!wallet) return null;
      const session = await ensureSession();
      return finalizeBet({
        data: { wallet, marketId, side: vars.side, txHash: vars.txHash, session },
      });
    },
    onSuccess: onDecided,
  });
  const pass = useMutation({
    mutationFn: async () => {
      if (!wallet) return null;
      // Free action: never prompt for a signature just to walk away.
      return bestEffort(async () => {
        const session = await ensureSession({ interactive: false });
        return finalizePass({ data: { wallet, marketId, session } });
      });
    },
    onSuccess: onDecided,
  });
  const foundation = useMutation({
    mutationFn: async (vars: { key: string; action: "YES" | "NO" | "PASS" }) => {
      if (!wallet) return null;
      // Free action: only recorded when the wallet already has a session.
      return bestEffort(async () => {
        const session = await ensureSession({ interactive: false });
        return recordFoundation({
          data: { wallet, marketId, key: vars.key, action: vars.action, session },
        });
      });
    },
    onSuccess: store,
  });
  return {
    betReveal: (side: "YES" | "NO", txHash: string) => bet.mutate({ side, txHash }),
    pass: () => pass.mutate(),
    // A pass has no on-chain fallback: if persisting it fails, the caller shows a
    // retry instead of silently advancing.
    passFailed: pass.isError,
    passing: pass.isPending,
    retryPass: () => pass.mutate(),
    trainFoundation: (key: string, action: "YES" | "NO" | "PASS") =>
      foundation.mutate({ key, action }),
    training: foundation.isPending,
    revealing: bet.isPending,
  };
}
