/**
 * Viewer market decisions — the ONE source of truth for "which markets has this
 * viewer already decided", used to remove them from the discovery queue (V1).
 *
 * A decision is a confirmed YES/NO purchase or a PASS — recorded explicitly, once
 * per (viewer, market), first-write-wins. Completion is NEVER inferred from token
 * balances, belief tables, or House prediction history; it is only ever this row.
 *
 * Server-only: reached exclusively through server functions that have already
 * verified wallet ownership. Callers pass an already-normalized (lowercased)
 * wallet; we normalize again defensively so the key is always consistent.
 */
import { serviceClient } from "@/lib/supabase-clients";

export type ViewerMarketDecision = "YES" | "NO" | "PASS";

/**
 * Persist a completed decision. First-write-wins: a market's first real decision
 * is the one that removes it from discovery, so a later tap never overwrites it
 * (ON CONFLICT DO NOTHING). Idempotent — safe to retry after a transient failure.
 * Throws on a real write error so the caller can surface a retry.
 */
export async function recordViewerDecision(
  wallet: string,
  marketId: number,
  decision: ViewerMarketDecision,
): Promise<void> {
  const sb = serviceClient();
  const { error } = await sb.from("viewer_market_decisions").upsert(
    {
      viewer_wallet: wallet.toLowerCase(),
      market_id: marketId,
      decision,
    },
    { onConflict: "viewer_wallet,market_id", ignoreDuplicates: true },
  );
  if (error) throw new Error(error.message);
}

/**
 * Every market id this viewer has already decided — the set the feed excludes.
 * Best-effort: on a read error it returns an empty set so a lookup failure never
 * empties the whole feed (the viewer just sees a decided market again, which is
 * strictly safer than showing nothing).
 */
export async function listCompletedMarketIds(wallet: string): Promise<Set<number>> {
  const sb = serviceClient();
  const { data, error } = await sb
    .from("viewer_market_decisions")
    .select("market_id")
    .eq("viewer_wallet", wallet.toLowerCase());
  if (error || !data) return new Set();
  return new Set(data.map((r) => Number(r.market_id)));
}
