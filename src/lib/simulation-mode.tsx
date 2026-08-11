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
 *
 * IT COMPOSES TWO READS, AND THEY ARE DELIBERATELY DIFFERENT KINDS OF THING.
 * The conviction count is a PUBLIC AGGREGATE: unsigned, available before anybody
 * has minted a session, and the number the entry card has to print to a wallet
 * that has never simulated. The account — balance, lifecycle — is the PRIVATE
 * LEDGER: proved by a wallet session, because a wallet address is public and
 * anyone could otherwise ask this server for somebody else's CC balance.
 *
 * Neither read may open a wallet. The account query supplies whatever session
 * already exists and resolves to null when there is none, so an unsigned reader
 * simply sees Real Mode and an entry card — never a signature prompt they did
 * not ask for.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffectiveWallet } from "@/hooks/useEffectiveWallet";
import { useWalletSession } from "@/hooks/useWalletSession";
import {
  profileProgressKey,
  profileProgressQO,
  simulationAccountKey,
  simulationAccountQO,
} from "@/lib/simulation-query";
import { activateSimulation, exitSimulation } from "@/lib/simulation.functions";
import type { SimulationState } from "@/lib/simulation.functions";
import { profileProgressFor, type ProfileProgress } from "@/domain/beliefs";
import {
  canOrder as canOrderIn,
  isSimulating,
  modeFor,
  simulationEligible,
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
  /**
   * THE CACHED WALLET SESSION, for the private reads elsewhere in the app.
   *
   * Exposed so the dock and the portfolio can prove ownership without each one
   * re-deriving how. Non-interactive by construction: it resolves an existing
   * session or rejects, and never opens a wallet — a read must not be the thing
   * that asks somebody to sign.
   */
  session: () => Promise<string>;
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
  session: () => Promise.reject(new Error("No wallet session.")),
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

  /**
   * WHATEVER SESSION ALREADY EXISTS, AND NEVER A NEW ONE.
   *
   * `interactive: false` is load-bearing: a READ must not be the thing that pops
   * a wallet signature. Without a session the private queries resolve to their
   * empty answer, the reader sees Real Mode and an entry card, and the card's
   * own action mints the session when they choose to start.
   */
  const cachedSession = useCallback(() => ensureSession({ interactive: false }), [ensureSession]);

  // PUBLIC: the count. Available with no session at all.
  const { data: progressData } = useQuery(profileProgressQO(wallet));
  // PRIVATE: the ledger. Proved, or null.
  const { data: account } = useQuery(simulationAccountQO(wallet, cachedSession));

  const write = (next: SimulationState) => {
    qc.setQueryData(simulationAccountKey(wallet), next.account);
    qc.setQueryData(profileProgressKey(wallet), next.progress);
    // Readiness reads the same rows through the other threshold, and is not
    // carried by this payload — invalidated rather than invented.
    void qc.invalidateQueries({ queryKey: ["readiness"] });
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
   * LEAVING IS ONE TAP, AND THE MODE GOES FIRST.
   *
   * The server cleanup is authenticated — closing somebody's Challenges is a
   * write under their name — and a session can have expired, which would put a
   * wallet prompt between a reader and the exit. Being unable to leave a mode is
   * the worst failure this feature has, and "one tap, no confirmation" is the
   * promise the banner makes.
   *
   * So the local mode is dropped IMMEDIATELY and the cleanup follows. The screen
   * returns to Real Mode on the tap; the Challenges close when the write lands.
   * If the session had aged out the wallet is asked once, but by then the reader
   * is already out of Simulation rather than held inside it waiting to sign.
   *
   * A FAILED CLEANUP IS NOT SILENT. `settled` re-reads the account, so a write
   * that never landed puts the banner back rather than leaving somebody looking
   * at Real Mode while the server still has them simulating.
   */
  const departure = useMutation({
    mutationFn: async (graduate: boolean) => {
      if (!wallet) throw new Error("Connect a wallet first.");
      // Out of the mode now, on the client, before anything can block.
      qc.setQueryData(simulationAccountKey(wallet), (prev: SimulationAccount | null | undefined) =>
        prev ? { ...prev, state: graduate ? "GRADUATED" : "EXITED" } : prev,
      );
      const session = await ensureSession({ interactive: true });
      return await exitSimulation({ data: { wallet, session, graduate } });
    },
    onError: (e: Error) => {
      setError(e.message || "We couldn't finish leaving Simulation.");
      // The optimistic exit was not confirmed — go and look rather than leave the
      // screen and the server disagreeing about which ledger this wallet is in.
      void qc.invalidateQueries({ queryKey: simulationAccountKey(wallet) });
    },
    onSuccess: (next, graduate) => {
      // A graduation gets no "your progress is saved" line — the profile IS the
      // progress, and the screen behind it already says so.
      setNotice(graduate ? null : SIMULATION_COPY.exitConfirmation);
      write(next);
    },
  });

  const adopt = useCallback(
    (next: Pick<SimulationState, "account" | "progress" | "mode">) => {
      // The order transaction computed both authoritatively — including the move
      // to GRADUATING when the tenth conviction settled — so both are written
      // rather than re-fetched. Nothing here derives a mode of its own.
      qc.setQueryData(simulationAccountKey(wallet), next.account);
      qc.setQueryData(profileProgressKey(wallet), next.progress);
      void qc.invalidateQueries({ queryKey: ["readiness"] });
    },
    [qc, wallet],
  );

  const value = useMemo<SimulationModeApi>(() => {
    const progress = progressData ?? profileProgressFor(0);
    const acct = account ?? null;
    /**
     * THE MODE IS DERIVED HERE, from the two reads, through the SAME pure
     * function the server uses. Two implementations of "which ledger is this" —
     * one for the screen and one for the write — is how a banner comes to say
     * Simulation while an order settles somewhere else.
     */
    const mode: SimulationMode = modeFor(acct, progress);
    return {
      mode,
      account: acct,
      balanceCc: acct?.balanceCc ?? null,
      profileProgress: progress,
      eligible: !!wallet && simulationEligible({ progress, state: acct?.state ?? null }),
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
      refresh: () => {
        void qc.invalidateQueries({ queryKey: simulationAccountKey(wallet) });
        void qc.invalidateQueries({ queryKey: profileProgressKey(wallet) });
      },
      adopt,
      session: cachedSession,
      pending: activation.isPending || departure.isPending,
      error,
      verifying,
      notice,
      dismissNotice: () => setNotice(null),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    progressData,
    account,
    wallet,
    activation.isPending,
    departure.isPending,
    error,
    verifying,
    notice,
    adopt,
    cachedSession,
    qc,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The one mode reader. Outside the provider it answers REAL, never undefined. */
export function useSimulationMode(): SimulationModeApi {
  return useContext(Ctx);
}
