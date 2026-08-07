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
import type { AudienceRow, LaunchProgress } from "@/domain/launch-audience";

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

/**
 * WHO SHOULD SEE THIS FIRST — the five recruitment rows for one market.
 *
 * Unsigned: it names people the caller could already find by browsing, and it
 * writes nothing. Sending is the signed act, and that is `sendInvites`.
 */
export const getLaunchAudience = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) =>
    z.object({ wallet: WALLET, marketId: z.number().int().nonnegative() }).parse(raw),
  )
  .handler(async ({ data }): Promise<AudienceRow[]> => {
    const { buildAudience } = await import("@/lib/launch.server");
    return buildAudience(data.wallet, data.marketId);
  });

/** What happened to the debate. Outcomes only — see launchLadder. */
export const getLaunchProgress = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) =>
    z.object({ marketId: z.number().int().nonnegative() }).parse(raw),
  )
  .handler(async ({ data }): Promise<LaunchProgress> => {
    const { buildProgress } = await import("@/lib/launch.server");
    return buildProgress(data.marketId);
  });

/**
 * THE ONE EVENT CONSOLIDATION HAS NEVER EMITTED.
 *
 * The duplicate panel has existed for a long time and recorded nothing, so
 * whether it ever diverted anybody has never been knowable — the feature could
 * have been working perfectly or doing nothing at all and both look identical
 * from outside. That is the failure this closes.
 *
 * `user_events` is the discovery-only interaction log the schema has always
 * had, with an anon INSERT policy and no writer anywhere in the codebase. It is
 * the right home and it needs no migration: reusing a table that already exists
 * beats minting one to hold a single event type.
 *
 * DELIBERATELY NARROW. One type, emitted from one place, meaning one thing: a
 * reader who was writing a question chose an existing market instead. It is
 * never an attribution claim — see check-launch for what this can and cannot
 * tell anyone.
 */
export const recordSimilarJoin = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z.object({ wallet: WALLET.nullish(), marketId: z.number().int().nonnegative() }).parse(raw),
  )
  .handler(async ({ data }): Promise<{ ok: true }> => {
    // Unsigned and fire-and-forget: it is a usage fact about a public click,
    // it grants nothing, and a failed metric must never cost a navigation.
    try {
      const { serviceClient } = await import("@/lib/supabase-clients");
      await serviceClient()
        .from("user_events")
        .insert({
          wallet: data.wallet ? data.wallet.toLowerCase() : null,
          onchain_id: data.marketId,
          type: "similar_market_join",
        });
    } catch {
      /* the click is the product; the measurement is not worth breaking it */
    }
    return { ok: true };
  });
