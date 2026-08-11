/**
 * The House round — cache key + finalize mutations.
 *
 * Extracted from the (now removed) MarketIntelligence container so the deck, the
 * mobile game and TheHouse can share the round logic without pulling a large
 * unused UI tree into the bundle.
 *
 * THE ROUND IS MODE-SCOPED, key included. A real round and a Simulation round on
 * the same market are two different rounds with two different proofs, and they
 * are stored apart precisely so neither can close the other. Sharing one cache
 * key would have undone that at the last step: the reveal would have written a
 * Simulation result into the entry the real screen reads.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  finalizeBet,
  finalizePass,
  finalizeSimulationReveal,
  finalizeSimulationPassFn,
  recordFoundation,
  type HouseMode,
  type HouseReadView,
} from "@/lib/house.functions";
import { useEffectiveWallet } from "@/hooks/useEffectiveWallet";
import { bestEffort, useWalletSession } from "@/hooks/useWalletSession";

export const houseKey = (wallet: string | undefined, marketId: number, mode: HouseMode = "REAL") =>
  ["house", wallet ?? null, marketId, mode] as const;

/** What proves a reveal was earned, in whichever ledger earned it. */
export type RevealProof = { txHash: string } | { simulationOrderId: number };

/**
 * Finalize the round. A verified BET reveals the House pick; a PASS closes the
 * round but keeps the pick sealed. Both refresh the locked read in the cache.
 */
export function useHouseFinalize(
  marketId: number,
  viewerWallet?: string,
  mode: HouseMode = "REAL",
) {
  const connected = useEffectiveWallet();
  const wallet = viewerWallet ?? connected;
  const { ensureSession, withSession } = useWalletSession();
  const qc = useQueryClient();
  const store = (data: HouseReadView | null) => {
    if (data) qc.setQueryData(houseKey(wallet, marketId, mode), data);
  };
  // A confirmed decision (buy or pass) removes this market from discovery, so the
  // feed must refresh immediately — not on the next 8s poll — and never show the
  // decided market again.
  const onDecided = (data: HouseReadView | null) => {
    store(data);
    void qc.invalidateQueries({ queryKey: ["opp-feed"] });
  };
  const bet = useMutation({
    mutationFn: async (vars: { side: "YES" | "NO"; proof: RevealProof }) => {
      if (!wallet) return null;
      if ("simulationOrderId" in vars.proof) {
        /**
         * A SETTLED ORDER ID IS NOT SELF-PROVING, so this one is signed. The
         * session already exists — placing the order required it moments ago — so
         * this is a reuse rather than a new prompt.
         */
        const simulationOrderId = vars.proof.simulationOrderId;
        return bestEffort(() =>
          withSession(
            (session) =>
              finalizeSimulationReveal({
                data: { wallet, marketId, side: vars.side, simulationOrderId, session },
              }),
            { interactive: false },
          ),
        );
      }
      const { txHash } = vars.proof;
      // NEVER a second prompt. The wallet just signed and paid for this buy; the
      // server proves ownership from the transaction's sender. A cached session
      // is passed along when one already exists, but none is requested.
      let session: string | undefined;
      try {
        session = await ensureSession({ interactive: false });
      } catch {
        session = undefined;
      }
      return finalizeBet({ data: { wallet, marketId, side: vars.side, txHash, session } });
    },
    onSuccess: onDecided,
  });
  const pass = useMutation({
    mutationFn: async () => {
      if (!wallet) return null;
      // Free action in both modes: never prompt for a signature just to walk away.
      // A Simulation pass costs no CC and closes only the Simulation round — the
      // real one for this market stays open.
      return bestEffort(() =>
        withSession(
          (session) =>
            mode === "SIMULATION"
              ? finalizeSimulationPassFn({ data: { wallet, marketId, session } })
              : finalizePass({ data: { wallet, marketId, session } }),
          { interactive: false },
        ),
      );
    },
    onSuccess: onDecided,
  });
  const foundation = useMutation({
    mutationFn: async (vars: { key: string; action: "YES" | "NO" | "PASS" }) => {
      if (!wallet) return null;
      // Free action: only recorded when the wallet already has a session.
      return bestEffort(() =>
        withSession(
          (session) =>
            recordFoundation({
              data: { wallet, marketId, key: vars.key, action: vars.action, session },
            }),
          { interactive: false },
        ),
      );
    },
    onSuccess: store,
  });

  return {
    betReveal: (side: "YES" | "NO", proof: RevealProof) => bet.mutate({ side, proof }),
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
