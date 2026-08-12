/**
 * The viewer-overlay surface. A thin server-function wrapper: the builder and
 * its cache live in `viewer-overlay.server.ts` where the server-only deps stay
 * off the client bundle. This is the `/viewer-overlay` boundary from the
 * architecture plan — the public feed painted first, this small private layer
 * fetched separately and applied on top.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { ViewerOverlay } from "@/lib/viewer-overlay.server";

export type { ViewerOverlay };

const input = z.object({
  wallet: z.string().min(3),
  sessionToken: z.string().min(16).max(2000).nullish(),
});

/**
 * The viewer overlay for the connected wallet — held + passed/hidden markets —
 * so the client can layer this person onto the public feed without the server
 * rebuilding a whole personalized feed.
 *
 * OWNERSHIP IS VERIFIED FIRST because the payload is the viewer's own private
 * interaction state. An unverified or mismatched session gets an EMPTY overlay,
 * never someone else's: the client then simply renders the public feed
 * unchanged, which is the correct signed-out-shaped behavior.
 */
export const getViewerOverlay = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) => input.parse(raw ?? {}))
  .handler(async ({ data }): Promise<ViewerOverlay> => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const { resolveViewerOverlay, emptyViewerOverlay } = await import(
      "@/lib/viewer-overlay.server"
    );
    try {
      const wallet = await assertWalletOwnership(data.wallet, data.sessionToken ?? null);
      return await resolveViewerOverlay(wallet);
    } catch {
      return emptyViewerOverlay(data.wallet.toLowerCase());
    }
  });
