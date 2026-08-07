/**
 * CHALLENGE — the door.
 *
 * Reading your own calls is unsigned: a Challenge panel is the viewer's own view
 * of relationships the DNA engine already computed for them, it grants nothing,
 * and demanding a signature to look at your own home screen would be absurd.
 *
 * Stamping an answer is unsigned for a different reason — it records a fact
 * that is already public on-chain (a position was taken) rather than producing
 * an identity. Nothing here puts one person's name in another's interface, which
 * is the line that forced `verifiedActor` onto the welcome path.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { AnsweredNotice, CallReach, Challenge } from "@/domain/challenge";

const WALLET = z.string().min(3).max(80);

/** Open calls: someone you trust took a side and you have not answered. */
export const getChallenges = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) => z.object({ wallet: WALLET.nullish() }).parse(raw ?? {}))
  .handler(async ({ data }): Promise<Challenge[]> => {
    // Signed out there is no "you" for anything to be addressed to, and an empty
    // array is the honest answer rather than a fallback list of popular markets.
    if (!data.wallet) return [];
    const { buildChallenges } = await import("@/lib/challenge.server");
    return buildChallenges(data.wallet);
  });

/** Calls your own conviction created, that somebody answered. */
export const getAnsweredCalls = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) => z.object({ wallet: WALLET.nullish() }).parse(raw ?? {}))
  .handler(async ({ data }): Promise<AnsweredNotice[]> => {
    if (!data.wallet) return [];
    const { answeredForMe } = await import("@/lib/challenge.server");
    return answeredForMe(data.wallet);
  });

/** How many qualified people this viewer's conviction is eligible to reach. */
export const getCallReach = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) => z.object({ wallet: WALLET.nullish() }).parse(raw ?? {}))
  .handler(async ({ data }): Promise<CallReach> => {
    if (!data.wallet) return { tribe: 0, rivals: 0 };
    const { callReachFor } = await import("@/lib/challenge.server");
    return callReachFor(data.wallet);
  });

/**
 * "I answered" — close every open call addressed to this wallet in this market.
 *
 * Called after a position is taken. Idempotent by the `responded_at IS NULL`
 * filter, so a re-render or a second trade changes nothing already recorded.
 */
export const answerCalls = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z.object({ wallet: WALLET, marketId: z.number().int().nonnegative() }).parse(raw),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { markCallsAnswered } = await import("@/lib/challenge.server");
    await markCallsAnswered(data.wallet, data.marketId);
    return { ok: true };
  });
