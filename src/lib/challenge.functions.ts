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
 * is the line that forces `verifiedActor` onto a server function — see
 * wallet-authorship.test.ts for the shape that rule exists to prevent.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { CallReach, Challenge, NamedPerson } from "@/domain/challenge";
import type { PairCalls } from "@/lib/challenge.server";
import type { Tally } from "@/domain/dependability";

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

/**
 * ONE RELATIONSHIP, BOTH DIRECTIONS — what the profile's history reads.
 *
 * Replaces `getAnsweredCalls`, which returned three dismissible notices about one
 * direction. Reading your own relationship with somebody grants nothing and names
 * nobody who is not already on the page, so it stays unsigned.
 */
export const getCallsWithPerson = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) =>
    z.object({ viewer: WALLET.nullish(), person: WALLET }).parse(raw),
  )
  .handler(async ({ data }): Promise<PairCalls | null> => {
    // Signed out there is no relationship to describe — null rather than an empty
    // shape, so the UI renders nothing instead of "no history yet".
    if (!data.viewer) return null;
    const { callsWithPerson } = await import("@/lib/challenge.server");
    return callsWithPerson(data.viewer, data.person);
  });

/** The same counts for a screenful of people — one round trip, not one each. */
export const getDependability = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) =>
    z.object({ viewer: WALLET.nullish(), wallets: z.array(WALLET).max(120) }).parse(raw),
  )
  .handler(async ({ data }): Promise<Record<string, { theirs: Tally; yours: Tally }>> => {
    if (!data.viewer || data.wallets.length === 0) return {};
    const { dependabilityFor } = await import("@/lib/challenge.server");
    return Object.fromEntries(await dependabilityFor(data.viewer, data.wallets));
  });

/**
 * How many qualified people this viewer's conviction is eligible to reach.
 * Scoped to a market when one is given, so people already holding a position
 * there are not counted as reachable.
 */
export const getCallReach = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) =>
    z
      .object({ wallet: WALLET.nullish(), marketId: z.number().int().nonnegative().nullish() })
      .parse(raw ?? {}),
  )
  .handler(async ({ data }): Promise<CallReach> => {
    if (!data.wallet) return { tribe: 0, rivals: 0 };
    const { callReachFor } = await import("@/lib/challenge.server");
    return callReachFor(data.wallet, data.marketId ?? undefined);
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
  .handler(async ({ data }): Promise<{ closed: NamedPerson[] }> => {
    const { markCallsAnswered } = await import("@/lib/challenge.server");
    // WHO this trade just answered, not merely that it succeeded. It is the one
    // moment the product can tell somebody they were counted on, and a bare
    // `{ ok: true }` threw that away at the exact instant it was true.
    return { closed: await markCallsAnswered(data.wallet, data.marketId) };
  });
