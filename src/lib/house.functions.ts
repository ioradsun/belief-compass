/**
 * The House — public server functions (thin wrappers around house.server.ts).
 * The predicted side never crosses the wire before the viewer has answered.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { loadHouseRead, recordBeliefAnswer, type HouseReadView } from "@/lib/house.server";

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

export const answerBelief = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        wallet: z.string().min(3),
        marketId: z.number().int().nonnegative(),
        action: z.enum(["YES", "NO", "SKIP"]),
        source: z.enum(["button", "keyboard", "gesture"]).default("button"),
      })
      .parse(raw),
  )
  .handler(async ({ data }) =>
    recordBeliefAnswer(data.wallet, data.marketId, data.action, data.source),
  );
