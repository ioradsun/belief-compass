/**
 * The House — public server functions (thin wrappers around house.server.ts).
 *
 * Bet-to-reveal: the predicted side never crosses the wire until the viewer has
 * placed a REAL, on-chain-verified bet. A skip closes the round but keeps the
 * pick sealed.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  loadHouseRead,
  finalizeHouseBet,
  finalizeHouseSkip,
  recordFoundationAnswer,
  type HouseReadView,
} from "@/lib/house.server";

export type { HouseReadView };

export const getHouseRead = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        wallet: z.string().min(3).nullable().optional(),
        marketId: z.number().int().nonnegative(),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => loadHouseRead(data.wallet ?? null, data.marketId));

/** Reveal the House pick by finalizing a verified on-chain buy. */
export const finalizeBet = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        wallet: z.string().min(3),
        marketId: z.number().int().nonnegative(),
        side: z.enum(["YES", "NO"]),
        txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "invalid tx hash"),
        session: z.string().min(16).max(2000),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const wallet = await assertWalletOwnership(data.wallet, data.session);
    return finalizeHouseBet(wallet, data.marketId, data.side, data.txHash);
  });

/** Close the round with a skip; the directional pick stays sealed. */
export const finalizeSkip = createServerFn({ method: "POST" })
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
    return finalizeHouseSkip(wallet, data.marketId);
  });

/** Answer one free foundation POV to train the House (cold start). */
export const recordFoundation = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        wallet: z.string().min(3),
        marketId: z.number().int().nonnegative(),
        key: z.string().min(1),
        action: z.enum(["YES", "NO", "SKIP"]),
        session: z.string().min(16).max(2000),
      })
      .parse(raw),
  )
  .handler(async ({ data }) => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const wallet = await assertWalletOwnership(data.wallet, data.session);
    return recordFoundationAnswer(wallet, data.marketId, data.key, data.action);
  });
