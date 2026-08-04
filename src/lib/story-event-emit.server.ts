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
import { decideTransitionEmit, type TransitionStore } from "@/domain/transition-emit";
import { accelerationFrom } from "@/domain/feed/score";

const num = (v: unknown): number => Number(v ?? 0) || 0;
const numOrNull = (v: unknown): number | null =>
  v == null || !Number.isFinite(Number(v)) ? null : Number(v);

/** Recover the emitter's hysteresis hint from a stored "type:side" fingerprint. */
function parsePrev(fp: string): { type: StoryEventType; side?: Side } | null {
  const [type, side] = fp.split(":");
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
interface Query {
  select: (cols: string) => {
    in: (col: string, vals: number[]) => Promise<{ data: Row[] | null }>;
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

  const [{ data: states }, { data: storedRows }] = await Promise.all([
    db
      .from("market_state")
      .select(
        "onchain_id, believers_yes, believers_no, new_believers_yes_24h, new_believers_no_24h, chg_24h_yes, chg_24h_no, trade_count_1h, trade_count_24h, velocity_5m, yes_capital_usd, no_capital_usd, yes_capital_delta_24h, no_capital_delta_24h",
      )
      .in("onchain_id", marketIds),
    db
      .from("market_transition_state")
      .select("onchain_id, fingerprint, first_seen_at, last_seen_at, last_emitted_at, seen_count")
      .in("onchain_id", marketIds),
  ]);

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
    const accel = accelerationFrom(
      num(r.trade_count_1h),
      num(r.trade_count_24h),
      num(r.velocity_5m),
    );
    const prevStore = storedById.get(id) ?? null;

    // Per-side 24h capital delta from market_state (snapshot-derived; null when no
    // baseline → treated as no signal so capital transitions can't fake it). Base =
    // current − delta, so the emitter's market-relative safeguard has a denominator.
    const yesCapDelta = numOrNull(r.yes_capital_delta_24h);
    const noCapDelta = numOrNull(r.no_capital_delta_24h);
    const yesCapNow = num(r.yes_capital_usd);
    const noCapNow = num(r.no_capital_usd);

    const transition = emitStoryEvent({
      timeframeShort: "24H",
      yes: {
        believerDelta: dYes,
        believerBase: Math.max(0, believersYes - dYes),
        capitalDeltaUsd: yesCapDelta ?? 0,
        capitalBaseUsd: yesCapDelta == null ? 0 : Math.max(0, yesCapNow - yesCapDelta),
        pricePct: numOrNull(r.chg_24h_yes),
      },
      no: {
        believerDelta: dNo,
        believerBase: Math.max(0, believersNo - dNo),
        capitalDeltaUsd: noCapDelta ?? 0,
        capitalBaseUsd: noCapDelta == null ? 0 : Math.max(0, noCapNow - noCapDelta),
        pricePct: numOrNull(r.chg_24h_no),
      },
      baseline: { accelerationMultiple: accel },
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
          headline: transition.headline,
          detail: transition.detail ?? null,
          side: transition.side ?? null,
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
