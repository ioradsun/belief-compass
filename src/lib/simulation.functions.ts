/**
 * SIMULATION — public server functions.
 *
 * WHICH OF THESE ARE SIGNED, and why it is not uniform. Reading your own
 * Simulation state grants nothing, names nobody and reveals nothing that is not
 * already yours — the same reasoning that leaves `getViewerReadiness` and the
 * Challenge reads unsigned.
 *
 * Every WRITE proves the wallet. Activation does because it creates an account
 * and grants a balance under that address; ordering does because it spends from
 * it. That verification is the existing off-chain wallet session — a message
 * signature, never a transaction. Nothing in this file sends anything to a
 * chain, asks for gas, or switches a network.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type {
  SimulationHolding,
  SimulationOrderResult,
  SimulationState,
} from "@/lib/simulation.server";

const WALLET = z.string().min(3).max(80);
const SESSION = z.string().min(16).max(2000);

/** Where this wallet stands: the account, the progress, the mode, eligibility. */
export const getSimulationState = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) => z.object({ wallet: WALLET.nullish() }).parse(raw ?? {}))
  .handler(async ({ data }): Promise<SimulationState> => {
    const { loadSimulationState, emptyState } = await import("@/lib/simulation.server");
    if (!data.wallet) return emptyState();
    return loadSimulationState(data.wallet);
  });

/**
 * Start simulating.
 *
 * A signature, and nothing else. No transaction is submitted, no network switch
 * is requested, no funds are moved — the wallet is proving who it is so the
 * progress can be saved against it, which is exactly what the entry card says.
 */
export const activateSimulation = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => z.object({ wallet: WALLET, session: SESSION }).parse(raw))
  .handler(async ({ data }): Promise<SimulationState> => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const wallet = await assertWalletOwnership(data.wallet, data.session);
    const { activateSimulation: activate } = await import("@/lib/simulation.server");
    return activate(wallet);
  });

/**
 * Stop simulating — the banner's one-tap Exit, and the graduation Continue.
 *
 * `graduate` is not a cosmetic flag: an exit is reversible while a graduation is
 * a one-way door, and the same call does both because the cleanup they share
 * (closing unresolved Simulation Challenges without recording a pass) is the
 * part that must never be skipped by either.
 */
export const exitSimulation = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z.object({ wallet: WALLET, session: SESSION, graduate: z.boolean().default(false) }).parse(raw),
  )
  .handler(async ({ data }): Promise<SimulationState> => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const wallet = await assertWalletOwnership(data.wallet, data.session);
    const { exitSimulation: exit } = await import("@/lib/simulation.server");
    return exit(wallet, data.graduate);
  });

/** Everything this wallet holds in Simulation, marked against the live market. */
export const getSimulationPositions = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) => z.object({ wallet: WALLET.nullish() }).parse(raw ?? {}))
  .handler(async ({ data }): Promise<SimulationHolding[]> => {
    if (!data.wallet) return [];
    const { loadSimulationPositions } = await import("@/lib/simulation.server");
    return loadSimulationPositions(data.wallet);
  });

/** One market's Simulation holding — what the dock and the sell form size against. */
export const getSimulationPosition = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) =>
    z.object({ wallet: WALLET.nullish(), marketId: z.number().int().nonnegative() }).parse(raw),
  )
  .handler(async ({ data }): Promise<SimulationHolding | null> => {
    if (!data.wallet) return null;
    const { loadSimulationPosition } = await import("@/lib/simulation.server");
    return loadSimulationPosition(data.wallet, data.marketId);
  });

/**
 * Place a Simulation order.
 *
 * The idempotency key is REQUIRED rather than generated here, because the point
 * of it is to survive a retry: a key minted on the server would be new on every
 * attempt and would deduplicate nothing. The client mints one per confirmed
 * order and re-sends the same one, so a double tap or a resend after a dropped
 * response returns the original settled result instead of spending CC twice.
 */
export const placeSimulationOrder = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        wallet: WALLET,
        session: SESSION,
        marketId: z.number().int().nonnegative(),
        side: z.enum(["YES", "NO"]),
        action: z.enum(["BUY", "SELL"]),
        /** BUY: CC committed. SELL: shares sold. */
        size: z.number().positive().finite(),
        idempotencyKey: z.string().min(8).max(120),
      })
      .parse(raw),
  )
  .handler(async ({ data }): Promise<SimulationOrderResult> => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const wallet = await assertWalletOwnership(data.wallet, data.session);
    const { executeSimulationOrder } = await import("@/lib/simulation.server");
    return executeSimulationOrder({
      wallet,
      marketId: data.marketId,
      side: data.side,
      action: data.action,
      size: data.size,
      idempotencyKey: data.idempotencyKey,
    });
  });

export type { SimulationState, SimulationHolding, SimulationOrderResult };
