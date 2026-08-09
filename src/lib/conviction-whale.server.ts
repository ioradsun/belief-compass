/**
 * THE CONVICTION WHALE — the read behind the honorary seat.
 *
 * One query over the markets already on screen, folded per market by the pure
 * rule in src/domain/conviction-whale. Everything difficult here is the two ways
 * this read can be silently wrong, both of which have already cost this codebase
 * a whole feature apiece:
 *
 * 1. TENURE COMES FROM `directional_since`, NOT `first_backed_at`. The reducer
 *    preserves directional_since across adds and trims, resets it on a flip and
 *    clears it on exit — which is precisely "still holding that side". Its
 *    neighbour `first_backed_at` is set once and NEVER reset, so a wallet that
 *    bought a year ago, left, and returned yesterday reads as a year-long
 *    holder. Both the live tape and standing facts currently read that column
 *    for tenure; this deliberately does not follow them.
 *
 * 2. VALUE COMES FROM `positionValueUsd`, NOT `yes_value_usd`. Nothing writes
 *    that column. The cohort emitter read it directly and, in its own words,
 *    "published nothing, ever" — every holder looked like dust. The failure has
 *    no symptom: a whale that crowns nobody is indistinguishable from a market
 *    where nobody has qualified yet, which is a legitimate outcome here.
 *
 * A market with nobody past the threshold simply has no whale. There is no
 * fallback, by design.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { readEthUsd } from "@/lib/eth-usd.server";
import { positionValueUsd } from "@/domain/position-value";
import { firstBackedIsFloor } from "@/domain/tenure";
import {
  findConvictionWhale,
  type ConvictionWhale,
  type WhaleCandidate,
} from "@/domain/conviction-whale";

/** Bounds the read the way every other per-market holder lookup here is bounded. */
const MAX_HOLDERS = 600;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * The whale of each market that has earned one. Markets with no eligible holder
 * are simply absent from the map — never present with a null.
 */
export async function loadConvictionWhales(
  sb: Pick<SupabaseClient, "from">,
  marketIds: number[],
): Promise<Map<number, ConvictionWhale>> {
  const out = new Map<number, ConvictionWhale>();
  if (marketIds.length === 0) return out;

  const [ethUsd, { data }] = await Promise.all([
    readEthUsd(sb),
    sb
      .from("wallet_beliefs")
      .select(
        "wallet, onchain_id, expressed_side, directional_since, yes_shares, no_shares, yes_value_usd, no_value_usd, value_updated_at, yes_cost, no_cost",
      )
      .in("onchain_id", marketIds)
      .in("expressed_side", ["YES", "NO"])
      .not("directional_since", "is", null)
      .limit(MAX_HOLDERS),
  ]);

  const now = Date.now();
  const byMarket = new Map<number, WhaleCandidate[]>();

  for (const b of (data ?? []) as Record<string, unknown>[]) {
    const side = String(b.expressed_side ?? "");
    if (side !== "YES" && side !== "NO") continue;

    const sinceMs = b.directional_since ? Date.parse(String(b.directional_since)) : Number.NaN;
    if (!Number.isFinite(sinceMs)) continue;

    const { usd } = positionValueUsd({
      valueUsd: side === "YES" ? b.yes_value_usd : b.no_value_usd,
      valueUpdatedAt: b.value_updated_at as string | null,
      shares: side === "YES" ? b.yes_shares : b.no_shares,
      costEth: side === "YES" ? b.yes_cost : b.no_cost,
      ethUsd,
      nowMs: now,
    });

    const id = Number(b.onchain_id);
    const list = byMarket.get(id) ?? [];
    list.push({
      wallet: String(b.wallet).toLowerCase(),
      side,
      daysHeld: (now - sinceMs) / 86_400_000,
      // A stance that predates the index has no knowable start, so its tenure is
      // a lower bound and the badge must read "19d+" rather than claim precision.
      tenureIsFloor: firstBackedIsFloor(sinceMs),
      valueUsd: num(usd),
    });
    byMarket.set(id, list);
  }

  for (const [id, candidates] of byMarket) {
    const whale = findConvictionWhale(candidates);
    if (whale) out.set(id, whale);
  }
  return out;
}
