/**
 * THE TABLE — server functions.
 *
 * WHY THESE THREE ARE SIGNED AND `getChallenges` IS NOT. Reading your own rail
 * grants nothing and names nobody who was not already computed for you. Putting
 * something on the table is the opposite: it writes a row bearing your name into
 * four other people's interfaces. That is the line this codebase already draws —
 * a server function that puts one person's name in another's surface must prove
 * the actor — and it is why `assertWalletOwnership` guards every write here, the
 * same helper the belief and house writes already use.
 *
 * Passing is signed for the same reason from the other direction: it is a durable
 * claim about what somebody chose, and an unsigned POST would let anyone mark
 * anyone as having passed on a question they never saw.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { PutResult, TableCandidate, TableRow } from "@/lib/table.server";

const WALLET = z.string().min(3).max(80);
const SESSION = z.string().min(8).max(4000);

/** What is on my table, with what became of each one. */
export const getTable = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) => z.object({ wallet: WALLET.nullish() }).parse(raw ?? {}))
  .handler(async ({ data }): Promise<TableRow[]> => {
    if (!data.wallet) return [];
    const { tableFor } = await import("@/lib/table.server");
    return tableFor(data.wallet);
  });

/**
 * WHAT AN EMPTY SLOT COULD HOLD — markets this wallet is already in.
 *
 * Reading your own possibilities grants nothing and names nobody, so it stays
 * unsigned for the same reason `getTable` is.
 */
export const getTableCandidates = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) =>
    z
      .object({ wallet: WALLET.nullish(), limit: z.number().int().min(0).max(3).default(3) })
      .parse(raw ?? {}),
  )
  .handler(async ({ data }): Promise<TableCandidate[]> => {
    if (!data.wallet || data.limit === 0) return [];
    const { tableCandidates } = await import("@/lib/table.server");
    return tableCandidates(data.wallet, data.limit);
  });

/** Choose this market as one of the three things in front of my people. */
export const putOnTable = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        wallet: WALLET,
        session: SESSION,
        marketId: z.number().int().nonnegative(),
        /** The call this relay continues, when it continues one. */
        parentCall: z.number().int().positive().nullish(),
      })
      .parse(raw),
  )
  .handler(async ({ data }): Promise<PutResult> => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const actor = await assertWalletOwnership(data.wallet, data.session);
    const { putOnTable: put } = await import("@/lib/table.server");
    return put(actor, data.marketId, data.parentCall ?? null);
  });

/** Take it off the table. Frees a slot; erases nothing. */
export const takeOffTable = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({ wallet: WALLET, session: SESSION, challengeId: z.number().int().positive() })
      .parse(raw),
  )
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const actor = await assertWalletOwnership(data.wallet, data.session);
    const { takeOffTable: close } = await import("@/lib/table.server");
    return { ok: await close(actor, data.challengeId) };
  });

/**
 * NOT FOR ME.
 *
 * Challenge lifecycle only. It never reaches Conviction Match and never reaches
 * Showing Up, and the creator is only ever told a count — never a name.
 */
export const passOnCall = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({ wallet: WALLET, session: SESSION, marketId: z.number().int().nonnegative() })
      .parse(raw),
  )
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const actor = await assertWalletOwnership(data.wallet, data.session);
    const { passCall } = await import("@/lib/table.server");
    return { ok: await passCall(actor, data.marketId) };
  });
