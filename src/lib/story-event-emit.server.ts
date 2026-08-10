/**
 * STORY EVENT EMITTER — persists what the Story Engine noticed.
 *
 * Runs in the market-refresher cron. For each market it reads the snapshot, asks
 * src/domain/story-event what the single most informative thing to say is, and
 * writes a canonical event ONLY when that state is new, persistent and not a
 * restatement (src/domain/transition-emit owns those rules).
 *
 * ON THE NAMES: the code says "story event" because the engine now emits
 * structural, community, momentum, tension and social stories — not only price
 * transitions. The DATABASE still says `market_transition` (the event kind and
 * the `market_transition_state` dedup table) because those names are already on
 * disk, in events rows that have shipped. Renaming them buys nothing and would
 * need a migration plus a rewrite of live history, so the boundary between the
 * two vocabularies is exactly here, and it is deliberate.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { emitStoryEvent, type Side, type StoryEventType } from "@/domain/story-event";
import { changeFrom24hRow, currencyDrift, materialMoves } from "@/domain/market-change";
import { scoreMarketTransition } from "@/domain/significance";
import { decideTransitionEmit, type TransitionStore } from "@/domain/transition-emit";
import { accelerationFrom } from "@/domain/feed/score";

/** Real trades in the last hour before "× normal" means anything at all. */
const MIN_RECENT_TRADES = 3;

const num = (v: unknown): number => Number(v ?? 0) || 0;

const numOrNull = (v: unknown): number | null =>
  v == null || !Number.isFinite(Number(v)) ? null : Number(v);

/**
 * Recover the emitter's hysteresis hint from a stored fingerprint.
 *
 * Most are "type:side". A material move is "material_move:metric:side", because
 * a capital move and a price move on one side must be separate episodes — so the
 * SIDE is the last segment, never the second.
 */
function parsePrev(fp: string): { type: StoryEventType; side?: Side } | null {
  const parts = fp.split(":");
  const type = parts[0];
  const side = parts[parts.length - 1];
  if (!type) return null;
  return {
    type: type as StoryEventType,
    side: side === "YES" || side === "NO" ? (side as Side) : undefined,
  };
}

/** Minimal untyped table surface — market_transition_state isn't in the generated
 *  types, and the events insert mirrors the believer-milestone RPC exactly. */
interface Row {
  [k: string]: unknown;
}
/** The banded price-baseline read (see below) — chained, so it needs its own shape. */
interface SnapshotQuery {
  select: (cols: string) => {
    in: (
      col: string,
      vals: number[],
    ) => {
      gte: (
        col: string,
        v: string,
      ) => {
        lte: (
          col: string,
          v: string,
        ) => {
          order: (col: string, o: { ascending: boolean }) => Promise<{ data: Row[] | null }>;
        };
      };
    };
  };
}
interface Query {
  select: (cols: string) => {
    in: (
      col: string,
      vals: number[],
    ) => Promise<{ data: Row[] | null; error?: { message: string } | null }>;
  };
  upsert: (
    rows: Row[],
    opts?: { onConflict?: string; ignoreDuplicates?: boolean },
  ) => Promise<unknown>;
  delete: () => { in: (col: string, vals: number[]) => Promise<unknown> };
}

export async function emitStoryEvents(
  sb: SupabaseClient,
  marketIds: number[],
  nowMs: number = Date.now(),
): Promise<number> {
  if (marketIds.length === 0) return 0;
  const db = sb as unknown as { from: (t: string) => Query };
  const nowIso = new Date(nowMs).toISOString();

  // SURFACE THE ERROR. Discarding it here is how this emitter produced zero rows
  // in production for weeks: two of its migrations were never applied, so the
  // select 400'd ("column market_state.yes_capital_delta_24h does not exist"),
  // `states` came back null, the loop ran zero times and the function returned 0.
  // An unapplied migration must scream, not look like a quiet day.
  const [{ data: states, error: stateErr }, { data: storedRows, error: storeErr }] =
    await Promise.all([
      db
        .from("market_state")
        .select(
          "onchain_id, believers_yes, believers_no, new_believers_yes_24h, new_believers_no_24h, trade_count_1h, trade_count_24h, trade_count_7d, velocity_5m, yes_capital_usd, no_capital_usd, yes_capital_delta_24h, no_capital_delta_24h, yes_price_usd, no_price_usd",
        )
        .in("onchain_id", marketIds),
      db
        .from("market_transition_state")
        .select("onchain_id, fingerprint, first_seen_at, last_seen_at, last_emitted_at, seen_count")
        .in("onchain_id", marketIds),
    ]);

  if (stateErr)
    throw new Error(
      `story events: market_state read failed (${stateErr.message}). A missing column usually means a migration has not been applied.`,
    );
  if (storeErr)
    throw new Error(
      `story events: market_transition_state read failed (${storeErr.message}). A missing table usually means a migration has not been applied.`,
    );

  // THE PRICE BASELINE, from the table that is actually being written.
  //
  // The obvious source is `market_state.chg_24h_yes`, which the story input
  // already carried. It is NULL ON ALL 2,762 MARKETS, and `market_window_change`
  // — the other SQL price-change path — is empty. Both jobs produce nothing,
  // while `market_state_snapshots` is current and holds 2.4M rows. Reading the
  // dead column would have made the price arm of the news rule permanently
  // silent and indistinguishable from a calm market.
  //
  // A narrow band rather than "everything older than 24h": snapshots are written
  // on every refresh, so an open-ended range would pull an unbounded number of
  // rows to find one per market. Newest-first inside the band, first row per
  // market wins. No band, no baseline, no price claim.
  const priceBase = new Map<number, { yes: number | null; no: number | null }>();
  try {
    const snapshots = sb as unknown as { from: (t: string) => SnapshotQuery };
    const { data: snaps } = await snapshots
      .from("market_state_snapshots")
      .select("onchain_id, yes_price_usd, no_price_usd, captured_at")
      .in("onchain_id", marketIds)
      .gte("captured_at", new Date(nowMs - 26 * 3_600_000).toISOString())
      .lte("captured_at", new Date(nowMs - 24 * 3_600_000).toISOString())
      .order("captured_at", { ascending: false });
    for (const row of snaps ?? []) {
      const sid = num(row.onchain_id);
      if (priceBase.has(sid)) continue; // newest in the band wins
      priceBase.set(sid, { yes: numOrNull(row.yes_price_usd), no: numOrNull(row.no_price_usd) });
    }
  } catch {
    // Best effort. Without it the price arm reports nothing, which is the
    // honest reading of "no history at this boundary".
  }

  const storedById = new Map<number, TransitionStore>();
  for (const s of storedRows ?? []) {
    storedById.set(num(s.onchain_id), {
      fingerprint: String(s.fingerprint),
      firstSeenAt: new Date(s.first_seen_at as string).getTime(),
      lastSeenAt: new Date(s.last_seen_at as string).getTime(),
      lastEmittedAt: s.last_emitted_at ? new Date(s.last_emitted_at as string).getTime() : null,
      seenCount: num(s.seen_count),
    });
  }

  // WHAT MOVED, per market, through the one shared derivation — the identical
  // module and thresholds the panels render from.
  const changeById = new Map<number, ReturnType<typeof changeFrom24hRow>>();
  for (const r of states ?? []) {
    const id = num(r.onchain_id);
    changeById.set(
      id,
      changeFrom24hRow({
        believersYes: num(r.believers_yes),
        believersNo: num(r.believers_no),
        newBelieversYes24h: num(r.new_believers_yes_24h),
        newBelieversNo24h: num(r.new_believers_no_24h),
        yesCapitalUsd: num(r.yes_capital_usd),
        noCapitalUsd: num(r.no_capital_usd),
        yesCapitalDelta24h: numOrNull(r.yes_capital_delta_24h),
        noCapitalDelta24h: numOrNull(r.no_capital_delta_24h),
        yesPriceUsd: numOrNull(r.yes_price_usd),
        noPriceUsd: numOrNull(r.no_price_usd),
        yesPriceBaseUsd: priceBase.get(id)?.yes ?? null,
        noPriceBaseUsd: priceBase.get(id)?.no ?? null,
      }),
    );
  }

  // THE CURRENCY, MEASURED — see MATERIAL in src/domain/market-change. A share
  // is worth a fixed 0.001 ETH until someone trades it, so the dollar value of
  // every market moves together with the exchange rate having done nothing. The
  // median of the batch is that shared move; subtracting it is what stops a five
  // percent ETH day from declaring a major move on every market at once.
  const drift = currencyDrift(
    [...changeById.values()].flatMap((c) => [c.yes.price.pct, c.no.price.pct]),
  );

  const events: Row[] = [];
  const upserts: Row[] = [];
  const clears: number[] = [];
  let emitted = 0;

  for (const r of states ?? []) {
    const id = num(r.onchain_id);
    const believersYes = num(r.believers_yes);
    const believersNo = num(r.believers_no);
    const dYes = num(r.new_believers_yes_24h);
    const dNo = num(r.new_believers_no_24h);
    // Acceleration is only a claim we can make when there are REAL recent
    // trades. `velocity_5m` extrapolates one tick into an hourly rate, so a
    // single (or stale) 5-minute sample against a near-empty 24h baseline
    // produced "24× normal" on markets with nothing in them. Require a handful
    // of actual trades in the last hour before any multiple is offered.
    const recentTrades = num(r.trade_count_1h);
    const accel =
      recentTrades >= MIN_RECENT_TRADES
        ? accelerationFrom(recentTrades, num(r.trade_count_24h), num(r.velocity_5m))
        : null;

    const prevStore = storedById.get(id) ?? null;

    // Per-side 24h capital delta from market_state (snapshot-derived; null when no
    // baseline → treated as no signal so capital transitions can't fake it). Base =
    // current − delta, so the emitter's market-relative safeguard has a denominator.
    const yesCapDelta = numOrNull(r.yes_capital_delta_24h);
    const noCapDelta = numOrNull(r.no_capital_delta_24h);
    const yesCapNow = num(r.yes_capital_usd);
    const noCapNow = num(r.no_capital_usd);

    const moves = materialMoves(changeById.get(id) ?? changeFrom24hRow({}), drift);

    const transition = emitStoryEvent({
      timeframeShort: "24H",
      // Voice only: this market's phrasing of a state, stable across recomputes.
      voiceKey: String(id),
      yes: {
        believerDelta: dYes,
        believerBase: Math.max(0, believersYes - dYes),
        capitalDeltaUsd: yesCapDelta ?? 0,
        capitalBaseUsd: yesCapDelta == null ? 0 : Math.max(0, yesCapNow - yesCapDelta),
        pricePct: changeById.get(id)?.yes.price.pct ?? null,
      },
      no: {
        believerDelta: dNo,
        believerBase: Math.max(0, believersNo - dNo),
        capitalDeltaUsd: noCapDelta ?? 0,
        capitalBaseUsd: noCapDelta == null ? 0 : Math.max(0, noCapNow - noCapDelta),
        pricePct: changeById.get(id)?.no.price.pct ?? null,
      },
      baseline: { accelerationMultiple: accel },
      // Cumulative windows, straight off the row: when the week's count equals
      // the day's, the six days before today were silent.
      activity: { trades24h: num(r.trade_count_24h), trades7d: num(r.trade_count_7d) },
      material: moves,
      prev: prevStore ? parsePrev(prevStore.fingerprint) : null,
      money: (usd) => `$${Math.round(usd)}`,
    });

    const decision = decideTransitionEmit({
      current: transition ? { fingerprint: transition.fingerprint, tier: transition.tier } : null,
      stored: prevStore,
      nowMs,
    });

    if (decision.state == null) {
      if (prevStore) clears.push(id);
      continue;
    }

    upserts.push({
      onchain_id: id,
      fingerprint: decision.state.fingerprint,
      first_seen_at: new Date(decision.state.firstSeenAt).toISOString(),
      last_seen_at: new Date(decision.state.lastSeenAt).toISOString(),
      last_emitted_at: decision.state.lastEmittedAt
        ? new Date(decision.state.lastEmittedAt).toISOString()
        : null,
      seen_count: decision.state.seenCount,
      updated_at: nowIso,
    });

    if (decision.emit && transition) {
      emitted += 1;
      // One event per episode (keyed by firstSeenAt): the cooldown gate already
      // prevents a second emission of the same fingerprint, so this stays unique.
      events.push({
        source_key: `transition:${id}:${transition.fingerprint}:${decision.state.firstSeenAt}`,
        source: "system",
        kind: "market_transition",
        market_id: String(id),
        side: transition.side ?? null,
        occurred_at: nowIso,
        payload: {
          type: transition.type,
          tier: transition.tier,
          /* NO FROZEN PROSE. The sentence is composed at read time from the
             structured fields below (src/domain/transition-copy), so a row
             written today can never speak an obsolete voice tomorrow. */
          side: transition.side ?? null,
          // WHICH MEASUREMENT MOVED. Persisted so the read-time editorial pass
          // can tell a capital reading from a price reading instead of lumping
          // every derived move together.
          metric: transition.metric ?? null,
          direction: transition.direction ?? null,
          // Universal significance, persisted at emission so the mixer compares
          // this against every other family on the one shared scale. Nothing
          // viewer-relative belongs here — that is a read-time boost.
          significance: scoreMarketTransition({
            type: transition.type,
            tier: transition.tier,
            observations: decision.state.seenCount,
          }).score,
        },
      });
    }
  }

  if (clears.length) await db.from("market_transition_state").delete().in("onchain_id", clears);
  if (upserts.length)
    await db.from("market_transition_state").upsert(upserts, { onConflict: "onchain_id" });
  if (events.length)
    await db.from("events").upsert(events, { onConflict: "source_key", ignoreDuplicates: true });

  return emitted;
}
