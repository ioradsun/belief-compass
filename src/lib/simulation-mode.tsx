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
  simulationRoutingKey,
  simulationRoutingQO,
} from "@/lib/simulation-query";
import { activateSimulation, exitSimulation } from "@/lib/simulation.functions";
import type { DepartureResult, SimulationState } from "@/lib/simulation.functions";
import { profileProgressFor, type ProfileProgress } from "@/domain/beliefs";
import {
  canOrder as canOrderIn,
  isSimulating,
  liveMode,
  modeResolved,
  simulationEligible,
  SIMULATION_COPY,
  type SimulationAccount,
  type SimulationLifecycle,
  type SimulationMode,
  type SimulationRouting,
} from "@/domain/simulation";

export interface SimulationModeApi {
  mode: SimulationMode;
  account: SimulationAccount | null;
  /** Spendable CC, or null when there is no account to read one from. */
  balanceCc: number | null;
  profileProgress: ProfileProgress;
  /** May this wallet start (or continue) Simulation at all? */
  eligible: boolean;
  /**
   * WHICH LEDGER OWNS EXECUTION HAS BEEN ESTABLISHED.
   *
   * False while the routing read is in flight. Nothing may execute in that
   * window — see `market-execution`, which hands out a refusing adapter rather
   * than choosing between two it cannot choose between.
   */
  resolved: boolean;
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

/**
 * THE DEFAULT IS UNKNOWN, NOT REAL.
 *
 * A component rendered outside the provider has not established anything, and
 * the context default is exactly the case this whole type exists for: absence of
 * an answer must never present itself as the answer that unlocks real money.
 */
const UNRESOLVED: SimulationModeApi = {
  mode: "UNKNOWN",
  account: null,
  balanceCc: null,
  profileProgress: profileProgressFor(0),
  eligible: false,
  resolved: false,
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

const Ctx = createContext<SimulationModeApi>(UNRESOLVED);

export function SimulationModeProvider({ children }: { children: ReactNode }) {
  const wallet = useEffectiveWallet();
  const qc = useQueryClient();
  const { ensureSession } = useWalletSession();
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * A DEPARTURE IS IN FLIGHT, AND THAT IS NOT THE SAME AS HAVING LEFT.
   *
   * The banner goes on the tap — that is the one-tap promise and it is right.
   * EXECUTION must not follow it. Writing EXITED optimistically made the mode
   * read as CONFIRMED REAL, so the facade offered the real-money executor while
   * the authenticated cleanup was still in flight and might yet be rejected:
   *
   *     server: ACTIVE · client: EXITED · real executor available
   *
   * The honest state in that window is UNKNOWN. The visual exit is a decision;
   * the execution transition is a FACT, and the server has not confirmed it yet.
   */
  const [departing, setDeparting] = useState(false);

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
  /**
   * PUBLIC: which ledger owns execution. THE MODE IS DERIVED FROM THIS, and
   * never from the account — the account read can fail for want of a session,
   * and a mode derived from it would report "could not prove" as "Real Mode".
   */
  const { data: routing } = useQuery(simulationRoutingQO(wallet));
  // PRIVATE: the ledger's contents. Proved, or null.
  const { data: account } = useQuery(simulationAccountQO(wallet, cachedSession));

  const write = (next: Pick<SimulationState, "account" | "progress">) => {
    // The routing fact FIRST: it is what the mode is derived from, so a write
    // that updated only the account would move the balance and leave the banner.
    qc.setQueryData(simulationRoutingKey(wallet), { state: next.account?.state ?? null });
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
      // Starting Simulation moves no money, so it opens a session silently
      // from the connected wallet — no signature prompt, nothing to announce.
      const session = await ensureSession();
      return await activateSimulation({ data: { wallet, session } });
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
    /**
     * OUT OF THE MODE NOW, AND THE OLD STATE KEPT SO IT CAN BE PUT BACK.
     *
     * The optimistic write is what makes Exit one tap: the screen leaves before
     * the authenticated cleanup, so a wallet prompt can never stand between
     * somebody and the door.
     *
     * THE SNAPSHOT IS THE OTHER HALF, and re-fetching is not a substitute for
     * it. The commonest failure here is a MISSING OR REJECTED SIGNATURE — and a
     * re-read in that state has no session either, so it returns null, which
     * reads as Real Mode all over again. The rollback would confirm the very
     * thing it was supposed to undo. Only the captured value can restore the
     * truth.
     */
    onMutate: () => {
      const previousRouting = qc.getQueryData<SimulationRouting>(simulationRoutingKey(wallet));
      const previousAccount = qc.getQueryData<SimulationAccount | null>(
        simulationAccountKey(wallet),
      );
      /**
       * UNKNOWN, NOT EXITED. `departing` forces the mode to UNKNOWN, which hides
       * the banner (a wallet that is not simulating has none) AND withholds both
       * executors — where writing EXITED would have hidden the banner and handed
       * over the real one. The cached values are left untouched so the rollback
       * below restores a world that actually existed.
       */
      setDeparting(true);
      return { previousRouting, previousAccount };
    },
    mutationFn: async (graduate: boolean) => {
      if (!wallet) throw new Error("Connect a wallet first.");
      const session = await ensureSession({ interactive: true });
      return await exitSimulation({ data: { wallet, session, graduate } });
    },
    onError: (e: Error, _graduate, context) => {
      setError(e.message || "We couldn't finish leaving Simulation.");
      // Put back exactly what was there. The screen and the server must not be
      // left disagreeing about which ledger owns this wallet.
      if (context) {
        qc.setQueryData(simulationRoutingKey(wallet), context.previousRouting);
        qc.setQueryData(simulationAccountKey(wallet), context.previousAccount ?? null);
      }
    },
    onSuccess: (next, graduate) => {
      /**
       * A REFUSED GRADUATION IS AN OUTCOME. The server reconciled the account
       * back to ACTIVE — a conviction fell away after GRADUATING was written —
       * so `write` puts the reader back at 9 / 10 with the banner and the order
       * form working, and the line says why the door did not open.
       */
      if (next.refusal === "not_complete") {
        setNotice(SIMULATION_COPY.notReadyYet);
        write(next);
        return;
      }
      // A graduation gets no "your progress is saved" line — the profile IS the
      // progress, and the screen behind it already says so.
      setNotice(graduate ? null : SIMULATION_COPY.exitConfirmation);
      write(next);
    },
    /**
     * THE FLAG CLEARS ONLY WHEN THE SERVER HAS ANSWERED — either way.
     *
     * On success the write above has already put the confirmed state in the
     * cache, so dropping `departing` reveals a REAL mode the server agrees with.
     * On failure the rollback has restored SIMULATION. Clearing it before the
     * answer would be the original defect with an extra step.
     */
    onSettled: () => setDeparting(false),
  });

  const adopt = useCallback(
    (next: Pick<SimulationState, "account" | "progress" | "mode">) => {
      // The order transaction computed both authoritatively — including the move
      // to GRADUATING when the tenth conviction settled — so both are written
      // rather than re-fetched. Nothing here derives a mode of its own.
      qc.setQueryData(simulationRoutingKey(wallet), { state: next.account?.state ?? null });
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
     * THE MODE IS DERIVED FROM THE ROUTING FACT, through the SAME pure function
     * the server uses. Two implementations of "which ledger is this" — one for
     * the screen and one for the write — is how a banner comes to say Simulation
     * while an order settles somewhere else.
     *
     * A wallet that is not connected has nothing to route and no executor to
     * offer either way, so it reads as REAL: there is no Simulation account
     * behind an address that does not exist. An address that IS connected waits
     * for its answer rather than assuming one.
     */
    const mode: SimulationMode = liveMode({
      connected: !!wallet,
      departing,
      routing,
      progress,
    });
    return {
      mode,
      account: acct,
      // Null until PROVED, in every mode. The order form fails closed on a null
      // balance rather than treating an unknown one as spendable.
      balanceCc: acct?.balanceCc ?? null,
      profileProgress: progress,
      eligible:
        !!wallet &&
        modeResolved(mode) &&
        simulationEligible({ progress, state: routing?.state ?? null }),
      resolved: modeResolved(mode),
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
        void qc.invalidateQueries({ queryKey: simulationRoutingKey(wallet) });
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
    routing,
    account,
    wallet,
    activation.isPending,
    departure.isPending,
    error,
    verifying,
    notice,
    departing,
    adopt,
    cachedSession,
    qc,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * The one mode reader. Outside the provider it answers UNKNOWN — which offers no
 * executor — rather than REAL, which would offer the real-money one.
 */
export function useSimulationMode(): SimulationModeApi {
  return useContext(Ctx);
}
