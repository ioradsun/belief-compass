/**
 * SIMULATION — public server functions.
 *
 * WHICH OF THESE ARE SIGNED, AND WHERE THE LINE ACTUALLY FALLS.
 *
 * It is not "reads are free, writes are proved". That rule is right for the
 * Challenge surfaces — reading your own rail grants nothing and names nobody who
 * was not already computed for you — and it is WRONG here, because a wallet
 * address is public. Anyone who knows an address could otherwise ask this
 * server for that person's CC balance, their simulated positions and their
 * account state, none of which they can see anywhere in the product. Simulation
 * positions are private to their owner in V1, and "private" has to mean the
 * server refuses, not that no screen happens to render them.
 *
 * So the line is drawn by WHAT THE ANSWER IS, not by read-versus-write:
 *
 *   SIGNED    the account's contents — balance, timestamps — the positions, and
 *             every write.
 *   UNSIGNED  the ROUTING FACT: which ledger owns execution for this wallet. One
 *             lifecycle state, nothing else. It cannot require a signature,
 *             because the application must route execution before anybody signs
 *             — and an app that cannot answer it would have to guess, which
 *             means treating an unresolved account as Real Mode.
 *   UNSIGNED  how many convictions somebody has — an aggregate over belief data
 *             the product already treats as viewer-readable, and the number the
 *             entry card has to print before anybody has signed anything.
 *
 * That split is also what keeps the entry card honest. It shows a real progress
 * count to a wallet that has never minted a session, and asks for the signature
 * at the moment it starts saving something against that address.
 *
 * Every write proves the wallet through the existing off-chain session — a
 * message signature, never a transaction. Nothing in this file sends anything to
 * a chain, asks for gas, or switches a network.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type {
  SimulationHolding,
  SimulationOrderResult,
  SimulationState,
} from "@/lib/simulation.server";
import type { SimulationAccount, SimulationRouting } from "@/domain/simulation";

const WALLET = z.string().min(3).max(80);
const SESSION = z.string().min(16).max(2000);

/**
 * WHICH LEDGER OWNS EXECUTION FOR THIS WALLET — unsigned, and deliberately so.
 *
 * THE ONE SIMULATION FACT THAT CANNOT WAIT FOR A SIGNATURE. The application has
 * to route execution before anybody signs anything, and an app that cannot
 * answer "which ledger is this" has only two options: refuse to trade at all, or
 * guess. Guessing means an unresolved account resolves to Real Mode, which hands
 * somebody the real-money executor on the strength of a query that had not come
 * back — the defect this endpoint exists to remove.
 *
 * IT RETURNS A LIFECYCLE STATE AND NOTHING ELSE. No balance, no positions, no
 * timestamps. To somebody guessing an address it discloses that the address is
 * or once was in Simulation, which is materially weaker than the ledger itself
 * and is the price of routing execution safely rather than optimistically.
 */
export const getSimulationRouting = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) => z.object({ wallet: WALLET.nullish() }).parse(raw ?? {}))
  .handler(async ({ data }): Promise<SimulationRouting> => {
    if (!data.wallet) return { state: null };
    const { loadSimulationRouting } = await import("@/lib/simulation.server");
    return loadSimulationRouting(data.wallet);
  });

/**
 * THE PRIVATE LEDGER'S ACCOUNT — balance and lifecycle, proved.
 *
 * The session is REQUIRED. `assertWalletOwnership` returns the wallet it
 * verified, and that is what is read from — so a request naming one address and
 * carrying another's session reads the session's, never the claim's.
 */
export const getSimulationAccount = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) => z.object({ wallet: WALLET, session: SESSION }).parse(raw))
  .handler(async ({ data }): Promise<SimulationAccount | null> => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const wallet = await assertWalletOwnership(data.wallet, data.session);
    const { loadSimulationAccount } = await import("@/lib/simulation.server");
    return loadSimulationAccount(wallet);
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
 * (closing unresolved Simulation Challenges without recording a pass, and
 * reconciling the Challenges those removals empty) is the part that must never
 * be skipped by either.
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
  .inputValidator((raw: unknown) => z.object({ wallet: WALLET, session: SESSION }).parse(raw))
  .handler(async ({ data }): Promise<SimulationHolding[]> => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const wallet = await assertWalletOwnership(data.wallet, data.session);
    const { loadSimulationPositions } = await import("@/lib/simulation.server");
    return loadSimulationPositions(wallet);
  });

/** One market's Simulation holding — what the dock and the sell form size against. */
export const getSimulationPosition = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) =>
    z
      .object({ wallet: WALLET, session: SESSION, marketId: z.number().int().nonnegative() })
      .parse(raw),
  )
  .handler(async ({ data }): Promise<SimulationHolding | null> => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const wallet = await assertWalletOwnership(data.wallet, data.session);
    const { loadSimulationPosition } = await import("@/lib/simulation.server");
    return loadSimulationPosition(wallet, data.marketId);
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
