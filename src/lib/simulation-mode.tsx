/**
 * SIMULATION MODE — the one application-level answer to "which ledger am I in?".
 *
 * Every mode-sensitive surface reads this and nothing else. The alternative — each
 * component asking the server, or worse, each component keeping its own flag —
 * is how a banner says SIMULATION while the dock spends real money.
 *
 * THE MODE IS NOT IN THE URL, and that is a product decision rather than a
 * routing preference. A mode in the query string would be shared with a market
 * link, would put somebody else into Simulation by opening it, and would be
 * changeable by typing. It lives on the server, keyed by wallet, so it survives a
 * refresh, follows the wallet rather than the browser, and cannot be activated by
 * a link. Connecting a DIFFERENT wallet loads that wallet's own state — the query
 * key carries the address, so nothing carries across.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffectiveWallet } from "@/hooks/useEffectiveWallet";
import { useWalletSession } from "@/hooks/useWalletSession";
import { simulationStateKey, simulationStateQO } from "@/lib/simulation-query";
import { activateSimulation, exitSimulation } from "@/lib/simulation.functions";
import type { SimulationState } from "@/lib/simulation.functions";
import { profileProgressFor, type ProfileProgress } from "@/domain/beliefs";
import {
  canOrder as canOrderIn,
  isSimulating,
  SIMULATION_COPY,
  type SimulationAccount,
  type SimulationMode,
} from "@/domain/simulation";

export interface SimulationModeApi {
  mode: SimulationMode;
  account: SimulationAccount | null;
  /** Spendable CC, or null when there is no account to read one from. */
  balanceCc: number | null;
  profileProgress: ProfileProgress;
  /** May this wallet start (or continue) Simulation at all? */
  eligible: boolean;
  /** Simulation owns the order and position surfaces right now. */
  active: boolean;
  /** A NEW Simulation order may be opened. False while graduating. */
  canOrder: boolean;
  activate: () => void;
  exit: () => void;
  continueAfterGraduation: () => void;
  refresh: () => void;
  /**
   * Adopt the state a settled order returned, without a round trip.
   *
   * The order RPC already computed the authoritative balance, position and
   * progress inside its transaction. Re-fetching them would be a second answer to
   * a question just answered, and there is a window between the two where the
   * banner would print the pre-order balance under a receipt for the order that
   * changed it.
   */
  adopt: (next: Pick<SimulationState, "account" | "progress" | "mode">) => void;
  /** A lifecycle write is in flight. */
  pending: boolean;
  /** The last activation/exit failure, in the reader's words. Null when fine. */
  error: string | null;
  /** True while activation is waiting on a wallet signature. */
  verifying: boolean;
  /**
   * THE ONE THING LEAVING SAYS, and only for as long as it is news.
   *
   * Exiting takes one tap and asks for no confirmation, which is right — but a
   * mode that vanishes silently reads as something having gone wrong, and the
   * fear this feature has to answer is "did I just lose my progress". So the
   * answer is stated once, where the reader is already looking, and then it
   * stops. Null in every other state.
   */
  notice: string | null;
  dismissNotice: () => void;
}

const REAL: SimulationModeApi = {
  mode: "REAL",
  account: null,
  balanceCc: null,
  profileProgress: profileProgressFor(0),
  eligible: false,
  active: false,
  canOrder: false,
  activate: () => {},
  exit: () => {},
  continueAfterGraduation: () => {},
  refresh: () => {},
  adopt: () => {},
  pending: false,
  error: null,
  verifying: false,
  notice: null,
  dismissNotice: () => {},
};

const Ctx = createContext<SimulationModeApi>(REAL);

export function SimulationModeProvider({ children }: { children: ReactNode }) {
  const wallet = useEffectiveWallet();
  const qc = useQueryClient();
  const { ensureSession } = useWalletSession();
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const { data } = useQuery(simulationStateQO(wallet));

  const write = (next: SimulationState) => {
    qc.setQueryData(simulationStateKey(wallet), next);
    // Progress moved, so the entry card's count and the readiness signal are both
    // stale. Invalidated rather than written: they are derived from the same rows
    // but not from this payload, and inventing their new values here would be a
    // second source of truth for a number this one does not actually carry.
    void qc.invalidateQueries({ queryKey: ["readiness"] });
    void qc.invalidateQueries({ queryKey: ["profile-progress"] });
  };

  /**
   * ACTIVATION NEEDS A SIGNATURE AND NOTHING ELSE.
   *
   * `interactive: true` so a first-time reader is actually asked — this is the
   * one Simulation action that may open the wallet, and the card says so in
   * advance. No transaction is built, no chain is switched, no funds are read.
   */
  const activation = useMutation({
    mutationFn: async () => {
      if (!wallet) throw new Error("Connect a wallet first.");
      setVerifying(true);
      try {
        const session = await ensureSession({ interactive: true });
        return await activateSimulation({ data: { wallet, session } });
      } finally {
        setVerifying(false);
      }
    },
    onSuccess: (next) => {
      setNotice(null);
      write(next);
    },
    onError: (e: Error) => setError(e.message || "We couldn't start Simulation."),
  });

  /**
   * LEAVING IS ONE TAP AND MUST NOT BE ABLE TO STRAND SOMEBODY.
   *
   * The signature is non-interactive: by the time anybody can press Exit they
   * have already signed to activate, so a cached session exists. If it somehow
   * does not, the wallet is asked once — because the alternative is an Exit
   * button that silently does nothing, and being unable to leave a mode is worse
   * than one prompt.
   */
  const departure = useMutation({
    mutationFn: async (graduate: boolean) => {
      if (!wallet) throw new Error("Connect a wallet first.");
      const session = await ensureSession({ interactive: true });
      return await exitSimulation({ data: { wallet, session, graduate } });
    },
    onSuccess: (next, graduate) => {
      // A graduation gets no "your progress is saved" line — the profile IS the
      // progress, and the screen behind it already says so.
      setNotice(graduate ? null : SIMULATION_COPY.exitConfirmation);
      write(next);
    },
    onError: (e: Error) => setError(e.message || "We couldn't leave Simulation."),
  });

  const adopt = useCallback(
    (next: Pick<SimulationState, "account" | "progress" | "mode">) => {
      qc.setQueryData(simulationStateKey(wallet), (prev: SimulationState | undefined) => ({
        account: next.account,
        progress: next.progress,
        mode: next.mode,
        // Eligibility is a lifecycle fact the order result does not carry, so the
        // known one is kept rather than guessed from the new progress.
        eligible: prev?.eligible ?? !next.progress.complete,
      }));
      void qc.invalidateQueries({ queryKey: ["readiness"] });
      void qc.invalidateQueries({ queryKey: ["profile-progress"] });
    },
    [qc, wallet],
  );

  const value = useMemo<SimulationModeApi>(() => {
    const state = data ?? null;
    const mode: SimulationMode = state?.mode ?? "REAL";
    return {
      mode,
      account: state?.account ?? null,
      balanceCc: state?.account?.balanceCc ?? null,
      profileProgress: state?.progress ?? profileProgressFor(0),
      eligible: !!state?.eligible && !!wallet,
      active: isSimulating(mode),
      canOrder: canOrderIn(mode),
      activate: () => {
        setError(null);
        activation.mutate();
      },
      exit: () => {
        setError(null);
        departure.mutate(false);
      },
      continueAfterGraduation: () => {
        setError(null);
        departure.mutate(true);
      },
      refresh: () => void qc.invalidateQueries({ queryKey: simulationStateKey(wallet) }),
      adopt,
      pending: activation.isPending || departure.isPending,
      error,
      verifying,
      notice,
      dismissNotice: () => setNotice(null),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    data,
    wallet,
    activation.isPending,
    departure.isPending,
    error,
    verifying,
    notice,
    adopt,
    qc,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The one mode reader. Outside the provider it answers REAL, never undefined. */
export function useSimulationMode(): SimulationModeApi {
  return useContext(Ctx);
}
