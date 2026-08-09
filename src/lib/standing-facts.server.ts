/**
 * STANDING FACTS — the read-time projection that gives quiet mode something to
 * say.
 *
 * There is no table here and no emitter, deliberately. A standing fact is not
 * an event that happened; it is a position someone is still holding, which the
 * database already knows. Persisting it would mean writing a row every time
 * somebody's tenure crossed an arbitrary line, and then managing the staleness
 * of rows that never actually go stale — the exact machinery the design exists
 * to avoid.
 *
 * So this reads `wallet_beliefs` for the markets already on screen and asks one
 * question: who is still here, and does the reader know any of them?
 *
 * WHY SERVICE-ROLE. `wallet_beliefs` is not readable by anon (by design), and
 * tenure is the whole substance of these facts. A missing key costs the facts,
 * never the page — the same degradation the live tape's tenure lookup uses, for
 * the same reason.
 */
import { serviceClientOrNull } from "@/lib/supabase-clients";
import { aliasFor } from "@/lib/wallet-identity";
import { firstBackedIsFloor } from "@/domain/tenure";
import { positionValueUsd } from "@/domain/position-value";
import {
  findStandingFacts,
  STANDING,
  type StandingFact,
  type StandingHolder,
} from "@/domain/standing-fact";
import type { NetworkLabel, Side } from "@/domain/story";

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v == null || !Number.isFinite(Number(v)) ? 0 : Number(v));

/**
 * How many markets one pass will look at. The pool only has to be deep enough
 * to outlast a quiet stretch, and every extra market is belief rows read on a
 * request path a reader is waiting on.
 */
const MAX_MARKETS = 24;
/** Belief rows per pass. Generous for 24 markets, bounded against a whale market. */
const MAX_BELIEFS = 1500;

export interface StandingFactsInput {
  marketIds: number[];
  /** The viewer's relationships, if signed in. Empty map is a valid reader. */
  labelByWallet: ReadonlyMap<string, NetworkLabel>;
  /** How many beliefs the viewer shares with each person — the crossing count. */
  crossingsByWallet: ReadonlyMap<string, number>;
  titleById: ReadonlyMap<number, string>;
  /** Days since each market opened, for a founding claim. Null → never claimed. */
  ageByMarket: ReadonlyMap<number, number | null>;
  now: number;
  /** How many facts to return. The scheduler decides when any of them is said. */
  limit: number;
}

/**
 * Build the pool. Returns [] rather than throwing on any failure — a quiet tape
 * with no standing facts is the status quo, and a feed that 500s because a
 * decoration could not be computed would be a strictly worse product.
 */
/** How many facts one market may contribute to a single reserve. */
const MAX_FACTS_PER_MARKET = 2;

export async function buildStandingFacts(input: StandingFactsInput): Promise<StandingFact[]> {
  const ids = input.marketIds.slice(0, MAX_MARKETS);
  if (ids.length === 0) return [];

  const svc = serviceClientOrNull();
  if (!svc) return [];

  const { data: rate } = await svc
    .from("calc_cache")
    .select("value")
    .eq("key", "eth_usd")
    .maybeSingle();
  const ethUsd = Number((rate as { value?: number } | null)?.value ?? 0) || 0;

  const { data, error } = await svc
    .from("wallet_beliefs")
    .select(
      "wallet, onchain_id, yes_shares, no_shares, yes_value_usd, no_value_usd, value_updated_at, yes_cost, no_cost, directional_since",
    )
    .in("onchain_id", ids)
    // Oldest belief first: if the ceiling ever bites it drops the shortest
    // tenures, which are the ones with the least to say.
    .order("directional_since", { ascending: true })
    .limit(MAX_BELIEFS);
  if (error || !data || data.length === 0) return [];

  // Group into (market, side) sets of holders. A wallet holding both sides is
  // two holders, because they believe two things and each has its own age.
  const byKey = new Map<string, StandingHolder[]>();
  for (const b of data as Row[]) {
    // The CURRENT hold, not first-ever participation — "has backed YES for 43
    // days" must not survive an exit and re-entry. See src/domain/tenure.
    const firstMs = b.directional_since ? Date.parse(String(b.directional_since)) : NaN;
    if (!Number.isFinite(firstMs)) continue;
    const daysHeld = (input.now - firstMs) / 86_400_000;
    const wallet = String(b.wallet).toLowerCase();
    const id = Number(b.onchain_id);
    for (const side of ["YES", "NO"] as const) {
      if (num(side === "YES" ? b.yes_shares : b.no_shares) <= 0) continue;
      // See src/domain/position-value: reading the unwritten `*_value_usd`
      // column alone made every position dust and this pool always empty.
      const { usd: positionUsd } = positionValueUsd({
        valueUsd: side === "YES" ? b.yes_value_usd : b.no_value_usd,
        valueUpdatedAt: b.value_updated_at as string | null,
        costEth: side === "YES" ? b.yes_cost : b.no_cost,
        ethUsd,
      });
      if (positionUsd < STANDING.minPositionUsd) continue;
      const key = `${id}:${side}`;
      const list = byKey.get(key) ?? [];
      list.push({
        wallet,
        name: null,
        avatarUrl: null,
        relationship: input.labelByWallet.get(wallet) ?? null,
        daysHeld,
        // A belief that was already there when the index opened has no knowable
        // start, so the sentence will say "11+ days" rather than "11 days".
        tenureIsFloor: firstBackedIsFloor(firstMs),
        positionUsd,
        crossings: input.crossingsByWallet.get(wallet) ?? null,
      });
      byKey.set(key, list);
    }
  }

  const all: StandingFact[] = [];
  for (const [key, holders] of byKey) {
    const [idStr, side] = key.split(":");
    const marketId = Number(idStr);
    all.push(
      ...findStandingFacts({
        marketId,
        marketTitle: input.titleById.get(marketId) ?? "",
        side: side as Side,
        holders,
        marketAgeDays: input.ageByMarket.get(marketId) ?? null,
      }),
    );
  }
  if (all.length === 0) return [];

  // Strongest first, and capped PER MARKET so a single crowded market cannot
  // own every quiet moment. Two rather than one: a strict cap of one meant a
  // tape scoped to a single market — the side rails, where quiet is most
  // visible — could only ever hold ONE standing fact, and once it was told the
  // panel had nothing left to say for the rest of the session.
  // The per-reader cooldown lives on the client, where the knowledge of what
  // this reader has already been told actually is.
  const chosen: StandingFact[] = [];
  const perMarket = new Map<number, number>();
  for (const f of all.sort((a, b) => b.strength - a.strength || a.key.localeCompare(b.key))) {
    const used = perMarket.get(f.marketId) ?? 0;
    if (used >= MAX_FACTS_PER_MARKET) continue;
    perMarket.set(f.marketId, used + 1);
    chosen.push(f);
    if (chosen.length >= input.limit) break;
  }

  // Names last, and only for the handful that survived — resolving every holder
  // to publish a few facts would be the expensive way round.
  const wallets = [...new Set(chosen.flatMap((f) => f.people.map((p) => p.wallet)))];
  const profiles = await import("@/lib/profiles.server")
    .then((m) => m.resolveProfiles(wallets, 15))
    .catch(() => new Map());
  return chosen.map((f) => ({
    ...f,
    people: f.people.map((p) => ({
      ...p,
      name: profiles.get(p.wallet)?.displayName ?? aliasFor(p.wallet),
      avatarUrl: profiles.get(p.wallet)?.pfpUrl ?? null,
    })),
  }));
}
