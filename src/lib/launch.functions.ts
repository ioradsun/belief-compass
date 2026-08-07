/**
 * LAUNCH — the door. Invitations out, the For You shelf in.
 *
 * AUTHORSHIP IS PROVEN, NOT CLAIMED. `sendInvites` puts the sender's name in
 * somebody else's interface, which is the exact shape of the hole `welcomes`
 * shipped with — see the note on `verifiedActor` in welcomes.functions.ts. A
 * missing or stale session FAILS here; it never falls through to the wallet the
 * caller asked to be.
 *
 * Reading the shelf is unsigned on purpose. A shelf is the viewer's own view of
 * their own invitations and relationships, it grants nothing, and asking for a
 * signature to look at your own home screen would be absurd. The wallet is
 * still only ever a lowercase key — nothing is written on this path.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { ForYouRow } from "@/domain/for-you";
import type { InviteResult } from "@/lib/launch.server";

const WALLET = z.string().min(3).max(80);

/**
 * The recipients, and why each of them. The REASON IS REQUIRED — an invitation
 * that cannot say why this person is exactly the thing the For You rule exists
 * to keep off the shelf, and letting the client omit it would put the decision
 * back in the client's hands.
 */
const RECIPIENT = z.object({
  toWallet: WALLET,
  reason: z.string().min(1).max(300),
  reasonKind: z.enum(["adjacent", "tribe", "rival", "category", "follower"]),
});

export const sendInvites = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        wallet: WALLET,
        session: z.string().min(8).nullish(),
        marketId: z.number().int().nonnegative(),
        recipients: z.array(RECIPIENT).min(1).max(25),
      })
      .parse(raw),
  )
  .handler(async ({ data }): Promise<InviteResult> => {
    if (!data.session) throw new Error("Verify your wallet first.");
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const from = await assertWalletOwnership(data.wallet, data.session);
    const { writeInvites } = await import("@/lib/launch.server");
    return writeInvites(from, data.marketId, data.recipients);
  });

/** Everything the platform can honestly say is about this viewer. */
export const getForYou = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) => z.object({ wallet: WALLET.nullish() }).parse(raw ?? {}))
  .handler(async ({ data }): Promise<ForYouRow[]> => {
    // Signed out there is no "you" to have a shelf for, and an empty array is
    // the honest answer rather than a fallback list of popular markets.
    if (!data.wallet) return [];
    const { buildForYou } = await import("@/lib/launch.server");
    return buildForYou(data.wallet);
  });

/**
 * "It reached them" — the first rung of the outcome ladder.
 *
 * Unsigned, like the read, and deliberately not idempotence-critical: the
 * server only records the FIRST view, so a duplicate call from a re-render
 * changes nothing. Worth noting what this is not — it does not mark the
 * invitation accepted. Joining is a position, and a position is on-chain.
 */
export const markInviteSeen = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z.object({ wallet: WALLET, marketId: z.number().int().nonnegative() }).parse(raw),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { markInviteViewed } = await import("@/lib/launch.server");
    await markInviteViewed(data.wallet, data.marketId);
    return { ok: true };
  });
