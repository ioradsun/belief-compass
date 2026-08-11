/**
 * MARKET EXECUTION — one interface, two adapters.
 *
 *   REAL        OrderTicket → chain-trade → wallet → contract → Base
 *   SIMULATION  OrderTicket → this adapter → the application database
 *
 * The ticket, the owned dock, the deck and the phone game all keep calling the
 * SAME shape. Nothing above this line knows whether a confirm becomes a
 * transaction or a row, which is the entire point: there is one order component,
 * not two, and `chain-trade.ts` stays real-only with no simulation branch inside
 * contract execution code.
 *
 * WHY THE SIMULATION ADAPTER TAKES WEI. Its signature is byte-for-byte
 * `useTrade`'s — `(marketId, yes, ethWei, quotedTokens)` — even though CC never
 * touches a chain. Two different signatures would have forced a branch at every
 * call site, and a branch at every call site is how "same product, separate
 * ledger" becomes two products. The adapter converts at its own boundary using
 * the 1:1 convention (100 CC prices exactly as a real $100 order would), which is
 * an internal calculation and never a rate anybody is shown.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTrade, useTradeReady } from "@/lib/chain-trade";
import { useSimulationMode } from "@/lib/simulation-mode";
import { useWalletSession } from "@/hooks/useWalletSession";
import { placeSimulationOrder, type SimulationOrderResult } from "@/lib/simulation.functions";
import { simulationPositionKey, simulationPositionsKey } from "@/lib/simulation-query";
import { weiToEth } from "@/domain/money";
import { ORDER_FAILED, type SimulationMode } from "@/domain/simulation";
import type { OrderSide } from "@/domain/order";

/**
 * THE CONTRACT BETWEEN A TICKET AND WHATEVER SETTLES IT.
 *
 * Exactly the surface `useTrade` already exposes, named so the ticket's type can
 * stop referring to the chain implementation by name.
 */
export interface TradeLike {
  buy(marketId: number, yes: boolean, ethWei: bigint, quotedTokens: bigint): Promise<unknown>;
  sell(
    marketId: number,
    yes: boolean,
    tokenAmount: bigint,
    quotedProceeds: bigint,
  ): Promise<unknown>;
  hash?: `0x${string}`;
  isSubmitting: boolean;
  /** Real: waiting on Base. Simulation: never — there is nothing to mine. */
  isMining: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: Error | null;
  reset(): void;
}

/**
 * WHAT THE SIMULATION TICKET NEEDS AND THE REAL ONE DOES NOT.
 *
 * Null in Real Mode, which is how every surface asks "am I simulating?" without
 * importing the mode: `sim ? … : …`. A truthy object carries everything the CC
 * copy needs, so no component derives a balance or a formatter of its own.
 */
export interface SimulationTicket {
  /** Spendable CC. Null while unknown — never rendered as zero. */
  balanceCc: number | null;
  /** Blocks a new order once the tenth conviction has landed. */
  canOrder: boolean;
  /**
   * The wallet is open for a SIGNATURE — an expired session being renewed, not a
   * transaction. Surfaced so the ticket says which of the two is happening
   * rather than leaving a wallet popup unexplained on a CC order.
   */
  verifying: boolean;
}

export interface ExecutionApi {
  mode: SimulationMode;
  /** The active ledger is the Simulation one. */
  simulated: boolean;
  /**
   * WHICH LEDGER OWNS EXECUTION IS KNOWN. False while the routing read is in
   * flight — and while it is false, `trade` is the REFUSING adapter rather than
   * either real one.
   */
  resolved: boolean;
  trade: TradeLike;
  /** Ticket descriptor for the Simulation ledger, or null in Real Mode. */
  sim: SimulationTicket | null;
  /**
   * Connected + on the right chain. Simulation is ALWAYS ready once a wallet is
   * connected: it never switches networks and never needs Base, so reporting
   * `onBase: false` would put "Switch to Base" on a button that sends nothing.
   */
  ready: { connected: boolean; onBase: boolean };
  /** The last settled Simulation order — the House's proof, and the receipt's. */
  lastOrder: SimulationOrderResult | null;
}

/**
 * A stable key per confirmed order, so a double tap cannot spend CC twice.
 *
 * Minted on the CLIENT and reused across retries of the SAME confirm, because a
 * key regenerated per attempt deduplicates nothing. It is released only when the
 * ticket resets — i.e. when the reader has decided about the previous order.
 */
function useIdempotencyKey() {
  const key = useRef<string | null>(null);
  return {
    take(seed: string) {
      if (!key.current) {
        const rand =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
        key.current = `${seed}:${rand}`;
      }
      return key.current;
    },
    release() {
      key.current = null;
    },
  };
}

/**
 * The Simulation execution adapter.
 *
 * NEVER calls `writeContractAsync`. Never asks for gas, never switches networks,
 * never debits a real wallet, and never moves the real market.
 *
 * WHAT IT CAN ASK FOR, AND THE COPY HAS TO MATCH. The order reuses the session
 * minted at activation, so in practice no prompt appears. But a session EXPIRES,
 * and a write keyed by a wallet cannot be accepted without proof of that wallet —
 * so on an aged-out session it re-authenticates, which opens the wallet for a
 * SIGNATURE. That is not a transaction and nothing is sent, but it is a wallet
 * appearing on a Confirm press, and a comment claiming it never happens would be
 * the kind of small untruth this mode cannot afford. `verifying` is surfaced so
 * the ticket can say which of the two is happening.
 */
function useSimulationTrade(
  wallet: string | undefined,
  ethUsd: number,
): TradeLike & {
  lastOrder: SimulationOrderResult | null;
  /** Waiting on a wallet SIGNATURE — never a transaction. */
  verifying: boolean;
} {
  const qc = useQueryClient();
  const { ensureSession } = useWalletSession();
  const { adopt } = useSimulationMode();
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [lastOrder, setLastOrder] = useState<SimulationOrderResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const idem = useIdempotencyKey();
  /**
   * The same synchronous re-entry latch the real executor uses, for the same
   * reason: React state is async, so two taps in one frame both read `submitting`
   * as false. The idempotency key makes a duplicate harmless server-side; this
   * makes it not happen.
   */
  const inFlight = useRef(false);

  const run = useCallback(
    async (input: { marketId: number; side: OrderSide; action: "BUY" | "SELL"; size: number }) => {
      if (!wallet) throw new Error("Connect a wallet first.");
      if (inFlight.current) return;
      inFlight.current = true;
      setError(null);
      setSubmitting(true);
      try {
        /**
         * The cached session first, and only then a prompt. Split so the ticket
         * can tell the reader WHICH is happening: a silent reuse needs no copy,
         * and a re-authentication deserves the line that says no transaction is
         * being sent.
         */
        let session: string;
        try {
          session = await ensureSession({ interactive: false });
        } catch {
          setVerifying(true);
          try {
            session = await ensureSession({ interactive: true });
          } finally {
            setVerifying(false);
          }
        }
        const result = await placeSimulationOrder({
          data: {
            wallet,
            session,
            marketId: input.marketId,
            side: input.side,
            action: input.action,
            size: input.size,
            idempotencyKey: idem.take(`${wallet}:${input.marketId}:${input.action}:${input.side}`),
          },
        });
        setLastOrder(result);
        setSuccess(true);
        // The order transaction already computed the authoritative account and
        // progress; adopting them beats re-reading state that was just written.
        adopt({ account: result.account, progress: result.progress, mode: result.mode });
        void qc.invalidateQueries({ queryKey: simulationPositionsKey(wallet) });
        void qc.invalidateQueries({ queryKey: simulationPositionKey(wallet, input.marketId) });
      } catch (e) {
        // The server's message when it has one (it names the actual CC balance on
        // an insufficient order); the neutral line otherwise. Never a bare
        // "failed", and never a claim that CC was spent when none was.
        setError(e instanceof Error && e.message ? e : new Error(ORDER_FAILED));
        throw e;
      } finally {
        setSubmitting(false);
        inFlight.current = false;
      }
    },
    // `adopt` and `idem` are stable; `ensureSession` re-binds only on account change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wallet, ethUsd, qc],
  );

  return useMemo(
    () => ({
      // ethWei → CC through the one internal convention. The ticket sized this
      // from the same rate, so the number the reader saw is the number committed.
      buy: (marketId: number, yes: boolean, ethWei: bigint) =>
        run({
          marketId,
          side: yes ? "YES" : "NO",
          action: "BUY",
          size: weiToEth(ethWei) * ethUsd,
        }),
      sell: (marketId: number, yes: boolean, tokenAmount: bigint) =>
        run({
          marketId,
          side: yes ? "YES" : "NO",
          action: "SELL",
          size: weiToEth(tokenAmount),
        }),
      isSubmitting: submitting,
      // NOTHING IS MINED. The whole family of "sent to Base / your wallet has been
      // debited / waiting to confirm" states is unreachable by construction rather
      // than merely hidden by copy.
      isMining: false,
      isSuccess: success,
      isError: !!error,
      error,
      reset: () => {
        setSuccess(false);
        setError(null);
        setSubmitting(false);
        setLastOrder(null);
        inFlight.current = false;
        idem.release();
      },
      lastOrder,
      verifying,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [run, submitting, success, error, lastOrder, verifying, ethUsd],
  );
}

/**
 * THE ADAPTER FOR "WE DO NOT KNOW YET".
 *
 * Not a third ledger — a REFUSAL. While the routing fact is unresolved the app
 * cannot choose between the two executors, and the old code resolved that by
 * choosing the real one, because an absent Simulation account and a confirmed
 * absence looked identical. That is the whole defect: a fresh tab, a slow query
 * or an expired session could put the real-money executor behind a Confirm
 * button belonging to somebody the server had in Simulation.
 *
 * So neither executor is handed out. This one throws if called at all, and every
 * surface renders its confirm disabled while `resolved` is false — belt and
 * braces, because a disabled button is a rendering decision and this is not.
 */
const UNRESOLVED_TRADE: TradeLike = Object.freeze({
  buy: () => Promise.reject(new Error("Still checking which account this order belongs to.")),
  sell: () => Promise.reject(new Error("Still checking which account this order belongs to.")),
  isSubmitting: false,
  isMining: false,
  isSuccess: false,
  isError: false,
  error: null,
  reset: () => {},
});

/**
 * THE FACADE. One call, and the surface above it stops caring which ledger it is
 * writing to.
 *
 * BOTH ADAPTERS ARE ALWAYS MOUNTED, deliberately. `useTrade` owns wagmi hooks and
 * the resumed-transaction effect; mounting it conditionally would break the rules
 * of hooks and, worse, would drop a real in-flight transaction the moment
 * somebody activated Simulation. Only ONE of them is ever handed a confirm.
 */
export function useMarketExecution(input: {
  viewerWallet: string | undefined;
  ethUsd: number;
}): ExecutionApi {
  const { mode, simulated, resolved, balanceCc, canOrder } = useSimulationModeSlice();
  const realTrade = useTrade();
  const realReady = useTradeReady();
  const simTrade = useSimulationTrade(input.viewerWallet, input.ethUsd);

  return useMemo(
    () => ({
      mode,
      simulated,
      resolved,
      /**
       * ONE OF THREE, AND THE THIRD IS A REFUSAL. `resolved` is checked FIRST:
       * an unresolved mode is not "not simulated", and reading it as such is
       * exactly how the real executor used to be handed out by default.
       */
      trade: !resolved ? UNRESOLVED_TRADE : simulated ? simTrade : realTrade,
      sim: simulated ? { balanceCc, canOrder, verifying: simTrade.verifying } : null,
      ready: simulated
        ? { connected: !!input.viewerWallet, onBase: true }
        : { connected: realReady.connected, onBase: realReady.onBase },
      lastOrder: simulated ? simTrade.lastOrder : null,
    }),
    [
      mode,
      simulated,
      resolved,
      simTrade,
      realTrade,
      balanceCc,
      canOrder,
      realReady.connected,
      realReady.onBase,
      input.viewerWallet,
    ],
  );
}

/** The slice of mode state the facade needs, kept narrow so re-renders are too. */
function useSimulationModeSlice() {
  const { mode, active, resolved, balanceCc, canOrder } = useSimulationMode();
  return { mode, simulated: active, resolved, balanceCc, canOrder };
}
