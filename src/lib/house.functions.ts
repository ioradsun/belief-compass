/**
 * The House — public server functions (thin wrappers around house.server.ts).
 *
 * Bet-to-reveal: the predicted side never crosses the wire until the viewer has
 * placed a REAL, on-chain-verified bet — unless the read is a STRONG_READ, which
 * the House calls out loud before the decision. A pass closes the round but keeps
 * a softer pick sealed.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  loadHouseRead,
  finalizeHouseBet,
  finalizeHousePass,
  finalizeSimulationBet,
  finalizeSimulationPass,
  recordFoundationAnswer,
  type HouseMode,
  type HouseReadView,
} from "@/lib/house.server";

export type { HouseReadView, HouseMode };

const MODE = z.enum(["REAL", "SIMULATION"]).default("REAL");

export const getHouseRead = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        wallet: z.string().min(3).nullable().optional(),
        marketId: z.number().int().nonnegative(),
        mode: MODE,
      })
      .parse(raw),
  )
  .handler(async ({ data }) => loadHouseRead(data.wallet ?? null, data.marketId, data.mode));

/**
 * Reveal the House pick by finalizing a verified on-chain buy.
 *
 * NO SIGNATURE. The buy itself is the proof: `finalizeHouseBet` requires a mined
 * transaction sent FROM this wallet, so asking the wallet to sign a message right
 * after it already signed and paid would be a second prompt proving less. A
 * cached session is still honoured when one happens to exist.
 */
export const finalizeBet = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        wallet: z.string().min(3),
        marketId: z.number().int().nonnegative(),
        side: z.enum(["YES", "NO"]),
        txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "invalid tx hash"),
        session: z.string().min(16).max(2000).optional(),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    let wallet = data.wallet;
    if (data.session) {
      const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
      wallet = await assertWalletOwnership(data.wallet, data.session);
    }
    return finalizeHouseBet(wallet, data.marketId, data.side, data.txHash);
  });

/**
 * Reveal the House pick from a settled SIMULATION order.
 *
 * SIGNED, unlike the real path — and the asymmetry is the point. A mined
 * transaction proves its own sender, so the real reveal needs no second prompt.
 * A Simulation order id proves nothing about who is asking, so the wallet
 * session is what stops one person opening another's round by guessing a number.
 */
export const finalizeSimulationReveal = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        wallet: z.string().min(3),
        marketId: z.number().int().nonnegative(),
        side: z.enum(["YES", "NO"]),
        simulationOrderId: z.number().int().positive(),
        session: z.string().min(16).max(2000),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const wallet = await assertWalletOwnership(data.wallet, data.session);
    return finalizeSimulationBet(wallet, data.marketId, data.side, data.simulationOrderId);
  });

/** Close the SIMULATION round with a pass. Free, and it costs no CC. */
export const finalizeSimulationPassFn = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        wallet: z.string().min(3),
        marketId: z.number().int().nonnegative(),
        session: z.string().min(16).max(2000),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const wallet = await assertWalletOwnership(data.wallet, data.session);
    return finalizeSimulationPass(wallet, data.marketId);
  });

/** Close the round with a pass; the directional pick stays sealed. */
export const finalizePass = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        wallet: z.string().min(3),
        marketId: z.number().int().nonnegative(),
        session: z.string().min(16).max(2000),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const wallet = await assertWalletOwnership(data.wallet, data.session);
    return finalizeHousePass(wallet, data.marketId);
  });

/** Answer one free foundation POV to train the House (cold start). */
export const recordFoundation = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        wallet: z.string().min(3),
        marketId: z.number().int().nonnegative(),
        key: z.string().min(1),
        action: z.enum(["YES", "NO", "PASS"]),
        session: z.string().min(16).max(2000),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const wallet = await assertWalletOwnership(data.wallet, data.session);
    return recordFoundationAnswer(wallet, data.marketId, data.key, data.action);
  });
