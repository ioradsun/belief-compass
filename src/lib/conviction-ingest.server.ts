/**
 * POV-positions ingest — server only.
 *
 * A POV user has already answered questions, so POV holds their positions. On
 * connect we pull them and seed wallet_beliefs directly, so conviction is real
 * for ANY user immediately — not only once the chain backfill reaches them. The
 * connected address IS the trading address (no linking, no remap), matching the
 * app's identity model. The chain indexer stays as background enrichment and
 * fills the on-chain-only fields (directional_since → days_held, cost basis);
 * we preserve those here so a later fold never gets clobbered.
 *
 * Honesty: POV /positions has no entry date. We seed directional_since to now
 * only for a currently-directional holding the chain hasn't dated yet — a
 * conservative "held since we first saw it" that can only understate, never
 * overstate, persistence. It sharpens truthfully once the chain proves an
 * earlier directional_since.
 */
import { classifyByShares, convictionFromValues } from "@/domain/domain";
import { fetchPovPositions } from "@/lib/pov.server";
import { publicClient, serviceClient } from "@/lib/supabase-clients";

const DUST = 0.01;

export interface IngestResult {
  address: string | null;
  positionCount: number;
  marketCount: number;
}

export async function ingestPositions(addressRaw: string | null): Promise<IngestResult> {
  const address = addressRaw ? addressRaw.toLowerCase() : null;
  if (!address) return { address: null, positionCount: 0, marketCount: 0 };

  let positions: Awaited<ReturnType<typeof fetchPovPositions>> = [];
  try {
    positions = await fetchPovPositions(address);
  } catch {
    positions = [];
  }
  if (positions.length === 0) return { address, positionCount: 0, marketCount: 0 };

  const sb = publicClient();
  const svc = serviceClient();

  // Map POV market uuids → our onchain_id. Positions in markets we haven't
  // imported are skipped — the app only speaks in on-chain markets.
  const uuids = [...new Set(positions.map((p) => p.marketId))];
  const idByUuid = new Map<string, number>();
  for (let i = 0; i < uuids.length; i += 500) {
    const { data: rows } = await sb
      .from("markets")
      .select("onchain_id, pov_uuid")
      .in("pov_uuid", uuids.slice(i, i + 500));
    for (const r of rows ?? []) {
      if (r.pov_uuid) idByUuid.set(String(r.pov_uuid), Number(r.onchain_id));
    }
  }

  interface Agg {
    yesShares: number;
    noShares: number;
    yesValue: number;
    noValue: number;
  }
  const byMarket = new Map<number, Agg>();
  for (const p of positions) {
    const id = idByUuid.get(p.marketId);
    if (id == null) continue;
    const a = byMarket.get(id) ?? { yesShares: 0, noShares: 0, yesValue: 0, noValue: 0 };
    if (p.side === "YES") {
      a.yesShares += p.tokenBalance;
      a.yesValue += p.currentValueUsd;
    } else {
      a.noShares += p.tokenBalance;
      a.noValue += p.currentValueUsd;
    }
    byMarket.set(id, a);
  }

  const marketIds = [...byMarket.keys()];
  if (marketIds.length === 0) return { address, positionCount: positions.length, marketCount: 0 };

  interface Existing {
    directional_since: string | null;
    first_backed_at: string | null;
    last_trade_at: string | null;
    yes_cost: number;
    no_cost: number;
  }
  const existing = new Map<number, Existing>();
  for (let i = 0; i < marketIds.length; i += 500) {
    const { data: rows } = await sb
      .from("wallet_beliefs")
      .select("onchain_id, directional_since, first_backed_at, last_trade_at, yes_cost, no_cost")
      .eq("wallet", address)
      .in("onchain_id", marketIds.slice(i, i + 500));
    for (const r of rows ?? []) {
      existing.set(Number(r.onchain_id), {
        directional_since: (r.directional_since as string | null) ?? null,
        first_backed_at: (r.first_backed_at as string | null) ?? null,
        last_trade_at: (r.last_trade_at as string | null) ?? null,
        yes_cost: Number(r.yes_cost ?? 0),
        no_cost: Number(r.no_cost ?? 0),
      });
    }
  }

  const now = Date.now();
  const nowIso = new Date().toISOString();
  const updates: Record<string, unknown>[] = [];
  for (const [id, a] of byMarket) {
    const ex = existing.get(id);
    const directional = a.yesShares > DUST || a.noShares > DUST;
    const dsince = ex?.directional_since ?? (directional ? nowIso : null);
    const daysHeld = dsince ? Math.max(0, (now - new Date(dsince).getTime()) / 86_400_000) : 0;
    const core = convictionFromValues(a.yesValue, a.noValue, daysHeld);
    updates.push({
      wallet: address,
      onchain_id: id,
      yes_shares: a.yesShares,
      no_shares: a.noShares,
      yes_cost: ex?.yes_cost ?? 0,
      no_cost: ex?.no_cost ?? 0,
      expressed_side: classifyByShares(a.yesShares, a.noShares),
      stance: core.stance,
      stance_side: core.stance_side,
      conviction: core.conviction,
      days_held: daysHeld,
      directional_since: dsince,
      first_backed_at: ex?.first_backed_at ?? (directional ? nowIso : null),
      last_trade_at: ex?.last_trade_at ?? null,
      updated_at: nowIso,
    });
  }

  for (let i = 0; i < updates.length; i += 500) {
    await svc
      .from("wallet_beliefs")
      .upsert(updates.slice(i, i + 500), { onConflict: "wallet,onchain_id" });
  }

  return { address, positionCount: positions.length, marketCount: marketIds.length };
}
