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
 * OWNERSHIP IS PROVEN FIRST, AND A FAILED PROOF PROPAGATES. The payload is the
 * viewer's own private interaction state, so a rejected `assertWalletOwnership`
 * is never swallowed and never resolves to the caller-supplied wallet — it
 * throws, the server function rejects, and the client treats a missing overlay
 * as "no overlay" and renders the public feed unchanged. A stale or absent
 * session therefore degrades to the signed-out shape without this function ever
 * attributing state to a wallet it could not verify. (See wallet-authorship.test.)
 */
export const getViewerOverlay = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) => input.parse(raw ?? {}))
  .handler(async ({ data }): Promise<ViewerOverlay> => {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const { resolveViewerOverlay } = await import("@/lib/viewer-overlay.server");
    const wallet = await assertWalletOwnership(data.wallet, data.sessionToken ?? null);
    return resolveViewerOverlay(wallet);
  });
