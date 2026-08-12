/**
 * THE VIEWER OVERLAY — the small per-viewer layer that turns the public feed
 * into this person's feed.
 *
 * The public home snapshot is the same for everyone. What changes for a
 * signed-in viewer is small and viewer-global: which markets they already hold,
 * and which they have passed or hidden. This module produces exactly that
 * overlay, so the client can layer this person onto the public list instead of
 * the server rebuilding and resending a whole personalized feed on the critical
 * path just because a wallet connected.
 *
 * ONE INDEXED READ. The overlay is cached two ways — an in-process slot for a
 * warm isolate, a durable `viewer_feed_state` row for a cold one — so the common
 * case is a single read, not the several relationship/history queries
 * loadViewerSignals runs. It is a CACHE: rebuilt on a stale read and refreshed
 * when the viewer passes/hides/sells, so a position or follow change that did
 * not push is caught by the next rebuild rather than served wrong.
 *
 * PRIVATE BY CONSTRUCTION. It carries the viewer's own interaction state, so the
 * server function that exposes it verifies wallet ownership first, and the
 * durable row sits behind RLS no client role can read.
 */
import { serviceClientOrNull } from "@/lib/supabase-clients";
import { dropSwr, swrCache } from "@/lib/server-cache";
import { loadViewerSignals } from "@/lib/feed/viewer-signals.server";

/** Payload-shape version — a reader ignores a row it does not understand. */
export const VIEWER_OVERLAY_VERSION = 1;

export interface ViewerOverlay {
  version: number;
  generatedAt: string;
  wallet: string;
  /** Markets the viewer holds an open position in. */
  heldMarketIds: number[];
  /** Markets the viewer has passed or hidden — the hard-exclusion hint. */
  excludedMarketIds: number[];
  /**
   * Markets the viewer HID — a durable decision, unlike a pass, which is
   * cycle-scoped and whose lifting the feed owns. Split out because only a hide
   * is safe for the client to apply to the public list on its own: a hidden
   * market is one the personalized feed will also drop, so removing it early
   * cannot diverge from what the server would have shown.
   */
  hiddenMarketIds: number[];
}

const SLOT_TTL_MS = 20_000;
/** How fresh a durable projection may be and still be served without a rebuild. */
const ROW_FRESH_MS = 30_000;
const READ_MS = 500;
const WRITE_MS = 700;

function slotKey(w: string): string {
  return `viewer:overlay:${w}`;
}

export function emptyViewerOverlay(w: string): ViewerOverlay {
  return {
    version: VIEWER_OVERLAY_VERSION,
    generatedAt: new Date().toISOString(),
    wallet: w,
    heldMarketIds: [],
    excludedMarketIds: [],
    hiddenMarketIds: [],
  };
}

/** Build the overlay from the viewer's authoritative state. Bounded queries. */
export async function buildViewerOverlay(wallet: string): Promise<ViewerOverlay> {
  const w = wallet.toLowerCase();
  // marketIds is empty on purpose: held and passed/hidden are viewer-global
  // (queried by wallet, not by market), so the overlay needs no market list and
  // the one scoped query loadViewerSignals runs — the follow overlap — is skipped.
  const signals = await loadViewerSignals(w, []);
  const held = [...signals.held];
  const hidden: number[] = [];
  const excluded: number[] = [];
  for (const [id, s] of signals.states) {
    if (s.hiddenAt) hidden.push(id);
    if (s.hiddenAt || s.passedAt) excluded.push(id);
  }
  const asc = (a: number, b: number) => a - b;
  return {
    version: VIEWER_OVERLAY_VERSION,
    generatedAt: new Date().toISOString(),
    wallet: w,
    heldMarketIds: held.sort(asc),
    excludedMarketIds: excluded.sort(asc),
    hiddenMarketIds: hidden.sort(asc),
  };
}

async function readProjection(
  w: string,
): Promise<{ overlay: ViewerOverlay; ageMs: number } | null> {
  try {
    const sb = serviceClientOrNull();
    if (!sb) return null;
    const read = sb
      .from("viewer_feed_state")
      .select("payload, updated_at")
      .eq("wallet", w)
      .maybeSingle();
    const res = await Promise.race([
      read,
      new Promise<null>((r) => setTimeout(() => r(null), READ_MS)),
    ]);
    const row = (res as { data?: { payload?: unknown; updated_at?: string } } | null)?.data;
    const payload = row?.payload as ViewerOverlay | undefined;
    if (!payload || typeof payload !== "object" || payload.version !== VIEWER_OVERLAY_VERSION) {
      return null;
    }
    const ageMs = row?.updated_at
      ? Date.now() - Date.parse(row.updated_at)
      : Number.POSITIVE_INFINITY;
    return { overlay: payload, ageMs };
  } catch {
    return null;
  }
}

async function writeProjection(w: string, overlay: ViewerOverlay): Promise<void> {
  try {
    const sb = serviceClientOrNull();
    if (!sb) return;
    const write = sb.from("viewer_feed_state").upsert(
      { wallet: w, payload: overlay as unknown as never, updated_at: new Date().toISOString() },
      { onConflict: "wallet" },
    );
    await Promise.race([
      Promise.resolve(write).then(() => true),
      new Promise<false>((r) => setTimeout(() => r(false), WRITE_MS)),
    ]);
  } catch {
    // A projection that fails to persist must never fail the overlay.
  }
}

/**
 * The viewer's overlay, through the in-process SWR cache so a fresh slot is
 * returned with no work and a stale one is served instantly while it refreshes
 * — the slot has a real TTL here (a plain peek would never expire, and there is
 * no per-wallet warmer to refresh it). On a cold or stale slot the factory
 * prefers a fresh durable row (the cross-isolate cache) and rebuilds only when
 * that is stale too, persisting the result for the next reader and isolate.
 *
 * Personalization is an enhancement, never a dependency: any failure falls back
 * to a stale durable row, then to an empty overlay, so the feed never throws.
 */
export async function resolveViewerOverlay(wallet: string): Promise<ViewerOverlay> {
  const w = wallet.toLowerCase();
  try {
    return await swrCache(slotKey(w), { ttlMs: SLOT_TTL_MS }, async () => {
      const proj = await readProjection(w);
      if (proj && proj.ageMs < ROW_FRESH_MS) return proj.overlay;
      const overlay = await buildViewerOverlay(w);
      await writeProjection(w, overlay);
      return overlay;
    });
  } catch {
    const proj = await readProjection(w).catch(() => null);
    return proj?.overlay ?? emptyViewerOverlay(w);
  }
}

/**
 * Force the viewer's overlay to rebuild on the next read. Called when they pass,
 * hide or sell — decisions that change held/excluded — so the change shows
 * without waiting out the freshness window. Drops the local slot and deletes the
 * durable row; the next `resolveViewerOverlay` rebuilds from authoritative state.
 */
export async function invalidateViewerFeedState(wallet: string): Promise<void> {
  const w = wallet.toLowerCase();
  dropSwr(slotKey(w));
  try {
    const sb = serviceClientOrNull();
    if (!sb) return;
    await sb.from("viewer_feed_state").delete().eq("wallet", w);
  } catch {
    // Invalidation is best-effort; the freshness window is the backstop.
  }
}
