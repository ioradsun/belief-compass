/**
 * Wallet identity resolution — server only.
 *
 * Turns raw wallet addresses into real POV people (name + picture) using the
 * `profiles` cache, lazily filling misses from pov.co (bounded) and writing
 * them back — including 404s as `not_found` so we never re-fetch a wallet with
 * no POV account. Callers fall back to the deterministic alias when a wallet
 * has no real identity.
 */
import { publicClient, serviceClient } from "@/lib/supabase-clients";
import type { WalletProfile } from "@/lib/wallet-identity";
import { fetchPovUser } from "@/lib/pov.server";

/** Max pov.co lookups per request; everything else comes from the cache. */
export const PROFILE_LAZY_CAP = 20;

export async function resolveProfiles(
  wallets: string[],
  lazyCap = PROFILE_LAZY_CAP,
): Promise<Map<string, WalletProfile>> {
  const map = new Map<string, WalletProfile>();
  const list = [...new Set(wallets.filter(Boolean).map((w) => w.toLowerCase()))];
  if (list.length === 0) return map;

  const sb = publicClient();
  const { data: cached } = await sb
    .from("profiles")
    .select("wallet, display_name, pfp_url, not_found")
    .in("wallet", list);
  const known = new Set<string>();
  for (const p of cached ?? []) {
    const w = String(p.wallet).toLowerCase();
    known.add(w);
    if (!p.not_found)
      map.set(w, { displayName: p.display_name ?? null, pfpUrl: p.pfp_url ?? null });
  }

  const misses = list.filter((w) => !known.has(w)).slice(0, lazyCap);
  if (misses.length === 0) {
    await applyOverrides(map, list);
    return map;
  }

  const results = await Promise.allSettled(misses.map((w) => fetchPovUser(w)));
  const nowIso = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  results.forEach((r, i) => {
    const w = misses[i];
    if (r.status !== "fulfilled") return; // transient error — retry next time
    const u = r.value;
    if (u) {
      map.set(w, { displayName: u.displayName ?? null, pfpUrl: u.pfpUrl ?? null });
      rows.push({
        wallet: w,
        username: u.username ?? null,
        display_name: u.displayName ?? null,
        pfp_url: u.pfpUrl ?? null,
        not_found: false,
        fetched_at: nowIso,
      });
    } else {
      rows.push({ wallet: w, not_found: true, fetched_at: nowIso });
    }
  });
  if (rows.length > 0) {
    try {
      await serviceClient().from("profiles").upsert(rows, { onConflict: "wallet" });
    } catch {
      /* cache write is best-effort */
    }
  }
  await applyOverrides(map, list);
  return map;
}

/** Self-set names/pictures win over anything resolved from POV. */
async function applyOverrides(map: Map<string, WalletProfile>, wallets: string[]) {
  try {
    const { data } = await publicClient()
      .from("profile_overrides")
      .select("wallet, display_name, avatar_url")
      .in("wallet", wallets);
    for (const o of data ?? []) {
      const w = String(o.wallet).toLowerCase();
      const prev = map.get(w) ?? { displayName: null, pfpUrl: null };
      map.set(w, {
        displayName: (o.display_name as string | null) ?? prev.displayName,
        pfpUrl: (o.avatar_url as string | null) ?? prev.pfpUrl,
      });
    }
  } catch {
    /* overrides are best-effort */
  }
}

