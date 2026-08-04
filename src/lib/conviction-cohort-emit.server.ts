/**
 * COHORT EMITTER — turns who is still holding into feed events.
 *
 * Runs in the market-refresher cron, beside the story-event emitter, and writes
 * into the SAME canonical `events` table every other feed row comes from. There
 * is no second feed and no second pipeline: a cohort is an event like any other,
 * and the surfaces that render it are the surfaces that already exist.
 *
 * WHY THIS IS NOT SPAM. Three gates, in order:
 *
 *   1. src/domain/conviction-cohort only sees a cohort in the window it CROSSED
 *      a rung. A market full of long-term holders emits nothing on a normal day.
 *   2. Only the single most significant cohort per (market, side) is written, so
 *      a market can never fill the feed with its own history.
 *   3. `source_key` carries the fingerprint (side · kind · rung · CROSSING DATE),
 *      so the same cohort is unwritable twice — the upsert drops it. That is the
 *      same idempotence the transition emitter relies on, not a new mechanism.
 *
 * THE CROSSING DATE IS PART OF THE IDENTITY. Without it, a market's YES side
 * could report a 30-day cohort exactly once in its entire life: a second wave of
 * believers crossing the same rung months later collided with the same key and
 * was dropped forever. Two different groups reaching thirty days are two facts,
 * not one — and suppressing the later ones is precisely how a feed goes quiet in
 * the markets that have been alive longest.
 *
 * The event stores the PEOPLE, not a rendered sentence, because the sentence
 * depends on where it is read: the app-wide feed names the market and the side,
 * a YES panel does not. One event, two renderings, one meaning.
 */
import { serviceClient } from "@/lib/supabase-clients";
import { aliasFor } from "@/lib/wallet-identity";
import { findCohorts, COHORT, HOLDING_RUNGS, type CohortHolder } from "@/domain/conviction-cohort";

type Row = Record<string, unknown>;
type Db = ReturnType<typeof serviceClient>;

const num = (v: unknown): number => (v == null || !Number.isFinite(Number(v)) ? 0 : Number(v));

/**
 * How much of a day's crossings this run is responsible for. The refresher runs
 * more than once a day, so a window of exactly 1 day would report the same
 * cohort on every run until it aged out. Keeping it at one day and letting
 * `source_key` absorb the repeats is simpler and provably correct.
 */
const WINDOW_DAYS = 1;

/**
 * Only the strongest cohorts are worth a row; the rest are true but not news.
 *
 * Calibrated against the viewer-independent score, where a group crossing 30
 * days scores ~0.33 and a 7-day group needs a real share of its side. Set too
 * high, this gate silences exactly the early rungs that carry a quiet market —
 * which is the opposite of what cohorts are for. The anti-spam work is done by
 * the crossing window, one-row-per-(market, side), the dust floor, the solo rung
 * bar and the source key; this is a quality floor, not a sixth lock.
 */
const MIN_SIGNIFICANCE = 0.25;

/**
 * The windows in which a rung is crossed TODAY, as `first_backed_at` ranges.
 *
 * A duration milestone is driven by the CLOCK, not by trading. The caller used
 * to hand us the markets it had just refreshed — the dirty ones — which meant a
 * market with long-held believers and no recent activity could never be looked
 * at, and its cohort could never be found. That is exactly backwards: cohorts
 * exist to make a QUIET market feel inhabited, and quiet markets were the ones
 * structurally excluded. Measured: zero conviction_cohort events had ever been
 * written in production.
 *
 * So the query is inverted. Instead of "which markets moved, do any of their
 * holders have an anniversary", it asks "who has an anniversary today" and lets
 * the markets follow. Small, precise, and independent of activity.
 */
function crossingWindows(nowMs: number, windowDays: number) {
  const day = 86_400_000;
  return HOLDING_RUNGS.map((rung: number) => ({
    rung,
    // Crossed rung R today ⇒ first_backed_at ∈ [now − R − window, now − R).
    from: new Date(nowMs - (rung + windowDays) * day).toISOString(),
    to: new Date(nowMs - rung * day).toISOString(),
  }));
}

/**
 * @param marketIds Optional NARROWING for a targeted run. Omit (or pass null)
 *   for the normal clock-driven scan across every market at once.
 */
export async function emitConvictionCohorts(marketIds: number[] | null, db: Db = serviceClient()) {
  const now = Date.now();
  // Only holders whose belief has an anniversary inside the window. This is the
  // whole candidate set, and it is tiny compared to every holder everywhere.
  const ranges = crossingWindows(now, WINDOW_DAYS);
  const orFilter = ranges
    .map(
      (r: { from: string; to: string }) =>
        `and(first_backed_at.gte.${r.from},first_backed_at.lt.${r.to})`,
    )
    .join(",");

  let bq = db
    .from("wallet_beliefs")
    .select(
      "wallet, onchain_id, yes_shares, no_shares, yes_value_usd, no_value_usd, first_backed_at",
    )
    .or(orFilter)
    .limit(4000);
  if (marketIds && marketIds.length > 0) bq = bq.in("onchain_id", marketIds);
  const { data: beliefs, error: beliefErr } = await bq;
  if (beliefErr) throw new Error(`cohorts: wallet_beliefs read failed: ${beliefErr.message}`);
  if (!beliefs || beliefs.length === 0) return 0;

  const touched = [...new Set((beliefs as Row[]).map((b) => Number(b.onchain_id)))];
  const [{ data: markets }, { data: states }] = await Promise.all([
    db.from("markets").select("onchain_id, created_at").in("onchain_id", touched),
    // The AUTHORITATIVE side size. We now fetch only the holders with an
    // anniversary, so counting them would make every cohort look like the whole
    // side — share would be 1.0 always and significance would be meaningless.
    db
      .from("market_state")
      .select("onchain_id, believers_yes, believers_no")
      .in("onchain_id", touched),
  ]);
  const sideSize = new Map<string, number>();
  for (const st of (states ?? []) as Row[]) {
    sideSize.set(`${Number(st.onchain_id)}:YES`, num(st.believers_yes));
    sideSize.set(`${Number(st.onchain_id)}:NO`, num(st.believers_no));
  }

  const ageByMarket = new Map<number, number | null>();
  for (const m of (markets ?? []) as Row[]) {
    const t = m.created_at ? Date.parse(String(m.created_at)) : NaN;
    ageByMarket.set(Number(m.onchain_id), Number.isFinite(t) ? (now - t) / 86_400_000 : null);
  }

  // Group holders by (market, side). A wallet holding both sides is two holders,
  // which is correct: they believe two things and each belief has its own age.
  const byKey = new Map<string, CohortHolder[]>();
  for (const b of (beliefs ?? []) as Row[]) {
    const first = b.first_backed_at ? Date.parse(String(b.first_backed_at)) : NaN;
    if (!Number.isFinite(first)) continue;
    const daysHeld = (now - first) / 86_400_000;
    const wallet = String(b.wallet).toLowerCase();
    const id = Number(b.onchain_id);
    for (const side of ["YES", "NO"] as const) {
      const shares = num(side === "YES" ? b.yes_shares : b.no_shares);
      if (shares <= 0) continue;
      const positionUsd = num(side === "YES" ? b.yes_value_usd : b.no_value_usd);
      if (positionUsd < COHORT.minPositionUsd) continue;
      const key = `${id}:${side}`;
      const list = byKey.get(key) ?? [];
      list.push({ wallet, name: null, avatarUrl: null, daysHeld, positionUsd });
      byKey.set(key, list);
    }
  }

  // Which cohorts clear the bar. Resolve identity only for those — naming 4000
  // wallets to publish a handful of rows would be the expensive way round.
  const chosen: Array<{ marketId: number; cohort: ReturnType<typeof findCohorts>[number] }> = [];
  for (const [key, holders] of byKey) {
    const [idStr, side] = key.split(":");
    const marketId = Number(idStr);
    const cohorts = findCohorts({
      side: side as "YES" | "NO",
      holders,
      marketAgeDays: ageByMarket.get(marketId) ?? null,
      // Real believers on the side, not just the ones with an anniversary.
      sideBelievers: sideSize.get(key) ?? holders.length,
      windowDays: WINDOW_DAYS,
      // The same clock `daysHeld` was measured against, so the crossing date in
      // the fingerprint is identical on every run of this job.
      nowMs: now,
    });
    const best = cohorts.find((c) => c.significance >= MIN_SIGNIFICANCE);
    if (best) chosen.push({ marketId, cohort: best });
  }
  if (chosen.length === 0) return 0;

  const wallets = [...new Set(chosen.flatMap((c) => c.cohort.people.map((p) => p.wallet)))];
  const profiles = await import("@/lib/profiles.server").then((m) =>
    m.resolveProfiles(wallets, 15),
  );

  const nowIso = new Date().toISOString();
  const events = chosen.map(({ marketId, cohort }) => ({
    // The fingerprint (side · kind · rung · crossing date) makes THIS cohort
    // unwritable twice, while leaving a later wave free to earn its own row.
    source_key: `cohort:${marketId}:${cohort.fingerprint}`,
    source: "system",
    kind: "conviction_cohort",
    market_id: String(marketId),
    side: cohort.side,
    occurred_at: nowIso,
    payload: {
      kind: cohort.kind,
      side: cohort.side,
      rung: cohort.rung,
      crossedOn: cohort.crossedOn,
      significance: cohort.significance,
      // People, not prose: the sentence is written where it is read.
      people: cohort.people.map((p) => {
        const prof = profiles.get(p.wallet);
        return {
          wallet: p.wallet,
          name: prof?.displayName ?? aliasFor(p.wallet),
          avatarUrl: prof?.pfpUrl ?? null,
          daysHeld: Math.round(p.daysHeld),
          positionUsd: Math.round(p.positionUsd),
        };
      }),
    },
  }));

  await db.from("events").upsert(events, { onConflict: "source_key", ignoreDuplicates: true });
  return events.length;
}
