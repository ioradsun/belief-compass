/**
 * Trade attribution — the one place the truth "conviction.company sent this"
 * exists.
 *
 * The contract's buy() carries no referrer, so a trade we route is
 * indistinguishable on-chain from the same wallet's trade on pov.co. We therefore
 * record the transaction hash at the moment we submit it; /value counts only
 * events that join back to one of these rows.
 *
 * Called fire-and-forget from the trade path: recording must never block, slow, or
 * fail a trade. Writes go through service-role here (the table has no public INSERT
 * grant), and the read side additionally requires the row to predate the block that
 * mined it, so a replayed public hash cannot be passed off as ours.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const input = z.object({
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  marketId: z.union([z.number(), z.string()]).optional(),
  side: z.enum(["YES", "NO"]).optional(),
  action: z.enum(["BUY", "SELL"]).optional(),
  chainId: z.number().optional(),
});

export const recordConvictionTrade = createServerFn({ method: "POST" })
  .inputValidator((data) => input.parse(data))
  .handler(async ({ data }) => {
    const { serviceClient } = await import("@/lib/supabase-clients");
    await serviceClient()
      .from("conviction_trades")
      .upsert(
        {
          tx_hash: data.txHash.toLowerCase(),
          wallet: data.wallet.toLowerCase(),
          market_id: data.marketId != null ? String(data.marketId) : null,
          side: data.side ?? null,
          action: data.action ?? null,
          chain_id: data.chainId ?? null,
        },
        { onConflict: "tx_hash", ignoreDuplicates: true },
      );
    return { ok: true };
  });
