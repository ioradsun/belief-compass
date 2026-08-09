/**
 * STANDING STORIES — the read-time projection that lets Insider report
 * persistence as an ordinary story rather than as a separate feed lane.
 *
 * There is no table here and no emitter, deliberately. A standing story is not
 * an event that happened; it is a position someone is still holding, which the
 * database already knows. Persisting it would mean writing a row every time
 * somebody's tenure crossed an arbitrary line, and then managing the staleness
 * of rows that never actually go stale — the exact machinery the design exists
 * to avoid.
 *
 * So this reads `wallet_beliefs` for the markets already on screen and asks two
 * questions: who is still here, and does their stillness CONTRAST with anything
 * the market did? The first produces receipts, the second produces
 * intelligence, and src/domain/standing-story decides which is which.
 *
 * WHY SERVICE-ROLE. `wallet_beliefs` is not readable by anon (by design), and
 * tenure is the whole substance of these stories. A missing key costs the
 * stories, never the page — the same degradation the live tape's tenure lookup
 * uses, for the same reason.
 */
import { serviceClientOrNull } from "@/lib/supabase-clients";
import { aliasFor } from "@/lib/wallet-identity";
import { firstBackedIsFloor } from "@/domain/tenure";
import { positionValueUsd } from "@/domain/position-value";
import { loadConvictionWhales } from "@/lib/conviction-whale.server";
import { STANDING, type StandingHolder } from "@/domain/standing-fact";
import {
  buildStandingStories as composeStandingStories,
  type StandingStoryRow,
} from "@/domain/standing-story";
import type { NetworkLabel, Side } from "@/domain/story";

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v == null || !Number.isFinite(Number(v)) ? 0 : Number(v));

const fin = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/**
 * How many markets one pass will look at. Every extra market is belief rows
 * read on a request path a reader is waiting on.
 */
const MAX_MARKETS = 24;
/** Belief rows per pass. Generous for 24 markets, bounded against a whale market. */
const MAX_BELIEFS = 1500;

/** The proven market change each side may be contrasted against. */
export interface StandingMarketEvidence {
  /** Relative 24h move in the YES price (+0.09 = YES up 9%). Null = unknown. */
  yesPriceChange24h?: number | null;
  yesCapitalDelta24h?: number | null;
  noCapitalDelta24h?: number | null;
  believersYes?: number | null;
  believersNo?: number | null;
  /** Days since the market opened, for a founding claim. */
  marketAgeDays?: number | null;
}

export interface StandingFactsInput {
  marketIds: number[];
  /** The viewer's relationships, if signed in. Empty map is a valid reader. */
  labelByWallet: ReadonlyMap<string, NetworkLabel>;
  /** How many beliefs the viewer shares with each person — the crossing count. */
  crossingsByWallet: ReadonlyMap<string, number>;
  titleById: ReadonlyMap<number, string>;
  /** Viewer-blind market state, per market. Absent → receipts only. */
  evidenceByMarket: ReadonlyMap<number, StandingMarketEvidence>;
  /**
   * PROVEN departures, keyed `${marketId}:${side}` — counted from the events
   * the feed already loaded, never inferred from a balance that got smaller.
   */
  exitsByKey?: ReadonlyMap<string, number>;
  now: number;
  /** How many stories to return. Ranking downstream decides which are shown. */
  limit: number;
}

/**
 * Build the candidates. Returns [] rather than throwing on any failure — a tape
 * with no standing stories is the status quo, and a feed that 500s because a
 * projection could not be computed would be a strictly worse product.
 */
/** How many stories one market may contribute to a single build. */
const MAX_FACTS_PER_MARKET = 2;

export async function buildStandingStories(
  input: StandingFactsInput,
): Promise<StandingStoryRow[]> {
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

  if (byKey.size === 0) return [];

  /* NAMES BEFORE COPY, not after.
     A standing story can name the person in its body ("Rummy has held YES for
     31 days"), so the identity has to exist before the sentence is composed —
     the old order resolved names after the fact and only worked because the
     old copy never used one. Only the holders that can actually appear are
     resolved: at most three per side, which is what `STANDING.maxPeople`
     already bounds the copy to. */
  const rankForCopy = (a: StandingHolder, b: StandingHolder) =>
    b.daysHeld - a.daysHeld || b.positionUsd - a.positionUsd || a.wallet.localeCompare(b.wallet);
  const namable = new Set<string>();
  for (const holders of byKey.values())
    for (const h of [...holders].sort(rankForCopy).slice(0, STANDING.maxPeople))
      namable.add(h.wallet);
  const profiles = await import("@/lib/profiles.server")
    .then((m) => m.resolveProfiles([...namable].slice(0, 72), 15))
    .catch(() => new Map());
  for (const holders of byKey.values())
    for (const h of holders) {
      if (!namable.has(h.wallet)) continue;
      h.name = profiles.get(h.wallet)?.displayName ?? aliasFor(h.wallet);
      h.avatarUrl = profiles.get(h.wallet)?.pfpUrl ?? null;
    }

  /* THE WHALE IS ESTABLISHED, NEVER INFERRED. `loadConvictionWhales` folds the
     real holder hierarchy; a market with nobody past the bar simply has no
     whale, and then no story here may mention one. A failed read costs the
     whale stories and nothing else. */
  const whales = await loadConvictionWhales(svc, ids).catch(() => new Map());

  const all: StandingStoryRow[] = [];
  for (const [key, holders] of byKey) {
    const [idStr, side] = key.split(":");
    const marketId = Number(idStr);
    const ev = input.evidenceByMarket.get(marketId);
    const yesMove = fin(ev?.yesPriceChange24h);
    const whale = whales.get(marketId) ?? null;
    all.push(
      ...composeStandingStories({
        marketId,
        marketTitle: input.titleById.get(marketId) ?? "",
        side: side as Side,
        holders,
        marketAgeDays: fin(ev?.marketAgeDays),
        // A side's own move. NO is the complement of YES, so the contrast is
        // read from the reader's side rather than always from YES's.
        sidePriceChange24h: yesMove == null ? null : side === "YES" ? yesMove : -yesMove,
        exits: input.exitsByKey?.get(`${marketId}:${side}`) ?? 0,
        capitalDelta24h: fin(side === "YES" ? ev?.yesCapitalDelta24h : ev?.noCapitalDelta24h),
        oppositeBelievers: fin(side === "YES" ? ev?.believersNo : ev?.believersYes),
        whale: whale
          ? { wallet: whale.wallet, side: whale.side, daysHeld: whale.daysHeld }
          : null,
      }),
    );
  }
  if (all.length === 0) return [];

  // Strongest first, and capped PER MARKET so one crowded market cannot own the
  // window. The per-reader cooldown lives on the client, where the knowledge of
  // what this reader has already been told actually is.
  const chosen: StandingStoryRow[] = [];
  const perMarket = new Map<number, number>();
  for (const f of all.sort((a, b) => b.strength - a.strength || a.key.localeCompare(b.key))) {
    const used = perMarket.get(f.marketId) ?? 0;
    if (used >= MAX_FACTS_PER_MARKET) continue;
    perMarket.set(f.marketId, used + 1);
    chosen.push(f);
    if (chosen.length >= input.limit) break;
  }
  return chosen;
}

