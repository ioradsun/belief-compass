/**
 * COHORT EMITTER — turns who is still holding into feed events.
 *
 * Runs in the market-refresher cron, beside the story-event emitter, and writes
 * into the SAME canonical `events` table every other feed row comes from. There
 * is no second feed and no second pipeline: a cohort is an event like any other,
 * and the surfaces that render it are the surfaces that already exist.
 *
 * WHY THIS IS NOT SPAM. Four gates, in order:
 *
 *   1. src/domain/conviction-cohort only sees a cohort in the window it CROSSED
 *      a rung. A market full of long-term holders emits nothing on a normal day.
 *   2. Only the single most significant cohort per (market, side) is written, so
 *      a market can never fill the feed with its own history.
 *   3. `source_key` carries the fingerprint (side · kind · rung · CROSSING DATE),
 *      so the same cohort is unwritable twice — the upsert drops it. That is the
 *      same idempotence the transition emitter relies on, not a new mechanism.
 *   4. A per-run CAP, because gates 1–3 all reason about one market at a time
 *      and the risk here is every market at once. Milestones are driven by the
 *      calendar, so markets whose believers arrived together cross together —
 *      and this platform's entire index begins on one date, which puts ~681
 *      markets on the same 30-day anniversary. The cap publishes the strongest
 *      and returns for the rest, so a mass crossing drains instead of dumping.
 *
 * AND ONE CATCH-UP PASS. A rung can only be crossed on one day; if nothing is
 * watching, the moment is gone, because no later window looks for it. Every
 * 7-day crossing this platform ever had was lost that way. So a bounded,
 * cursor-driven sweep walks each market once asking who is STANDING at a rung
 * rather than who crossed one today. It derives the same crossing date and
 * therefore the same fingerprint, so it can never double-tell a fact the daily
 * pass already told, and it stops for good once the cursor runs out of markets.
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
import { positionValueUsd } from "@/domain/position-value";
import { aliasFor } from "@/lib/wallet-identity";
import { readEthUsd } from "@/lib/eth-usd.server";
import {
  findCohorts,
  selectCohortsForRun,
  COHORT,
  HOLDING_RUNGS,
  type CohortCandidate,
  type CohortHolder,
  type CohortScan,
} from "@/domain/conviction-cohort";

type Row = Record<string, unknown>;
type Db = ReturnType<typeof serviceClient>;

const num = (v: unknown): number => (v == null || !Number.isFinite(Number(v)) ? 0 : Number(v));

/** The cron-refreshed ETH→USD rate. 0 when unknown, which disables the fallback
 *  rather than pricing every position at nothing. */
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

const BELIEF_COLUMNS =
  "wallet, onchain_id, yes_shares, no_shares, yes_value_usd, no_value_usd, value_updated_at, yes_cost, no_cost, first_backed_at";

/** One page of a paginated read. */
const PAGE_SIZE = 1000;
/**
 * How many pages one run will read before giving up on completeness.
 *
 * This replaced a bare `.limit(4000)`, which was not a bound but a TRUNCATION:
 * PostgREST returned an arbitrary four thousand rows in whatever order the
 * planner chose, so on the day a large cohort crosses, which believers got a
 * story depended on the query plan. Reading in pages means a normal day is
 * complete, and the ceiling only bites in a scenario the pacing cap already
 * handles.
 */
const MAX_PAGES = 8;

/** A PostgREST builder narrowed to the one thing pagination needs from it. */
type Pageable = {
  range: (
    from: number,
    to: number,
  ) => Promise<{ data: Row[] | null; error: { message: string } | null }>;
};

/** Read every matching belief, in pages, instead of truncating at an arbitrary row. */
async function readBeliefs(db: Db, build: (q: ReturnType<Db["from"]>) => unknown): Promise<Row[]> {
  const out: Row[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = build(db.from("wallet_beliefs")) as Pageable;
    const { data, error } = await q.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw new Error(`cohorts: wallet_beliefs read failed: ${error.message}`);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < PAGE_SIZE) break;
  }
  return out;
}

/**
 * The best `cap` candidates that have NOT already been published.
 *
 * `selectCohortsForRun` is deterministic on purpose, which means without this
 * step every run would re-select the identical winners, find them already
 * written, and never reach anything behind them. Checking the top few multiples
 * of the cap is enough — we only need `cap` survivors — and keeps the
 * `source_key` lookup to a few dozen keys rather than hundreds.
 */
async function pickUnpublished(
  db: Db,
  candidates: CohortCandidate[],
  cap: number,
): Promise<CohortCandidate[]> {
  if (candidates.length === 0 || cap <= 0) return [];
  const shortlist = selectCohortsForRun(candidates, cap * 4);
  const keys = shortlist.map((c) => sourceKeyFor(c));
  const { data: existing, error } = await db
    .from("events")
    .select("source_key")
    .in("source_key", keys);
  if (error) throw new Error(`cohorts: published-key lookup failed: ${error.message}`);
  const already = new Set((existing ?? []).map((e: Row) => String(e.source_key)));
  return shortlist.filter((c) => !already.has(sourceKeyFor(c))).slice(0, cap);
}

/** The fingerprint (side · kind · rung · crossing date) makes a fact unwritable twice. */
const sourceKeyFor = (c: CohortCandidate) => `cohort:${c.marketId}:${c.cohort.fingerprint}`;

/**
 * Turn a set of beliefs into the cohorts worth publishing. Shared by both
 * passes so the daily path and the catch-up path can never disagree about what
 * counts — only about which holders they were handed.
 */
async function cohortsFrom(
  db: Db,
  beliefs: Row[],
  now: number,
  scan: CohortScan,
): Promise<CohortCandidate[]> {
  if (beliefs.length === 0) return [];
  const ethUsd = await readEthUsd(db);
  const touched = [...new Set(beliefs.map((b) => Number(b.onchain_id)))];
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
  for (const b of beliefs) {
    const first = b.first_backed_at ? Date.parse(String(b.first_backed_at)) : NaN;
    if (!Number.isFinite(first)) continue;
    const daysHeld = (now - first) / 86_400_000;
    const wallet = String(b.wallet).toLowerCase();
    const id = Number(b.onchain_id);
    for (const side of ["YES", "NO"] as const) {
      const shares = num(side === "YES" ? b.yes_shares : b.no_shares);
      if (shares <= 0) continue;
      // `yes_value_usd` is a column nothing writes, so reading it alone made
      // every holder look like dust and this emitter publish nothing, ever.
      const { usd: positionUsd } = positionValueUsd({
        valueUsd: side === "YES" ? b.yes_value_usd : b.no_value_usd,
        valueUpdatedAt: b.value_updated_at as string | null,
        costEth: side === "YES" ? b.yes_cost : b.no_cost,
        ethUsd,
      });
      if (positionUsd < COHORT.minPositionUsd) continue;
      const key = `${id}:${side}`;
      const list = byKey.get(key) ?? [];
      list.push({ wallet, name: null, avatarUrl: null, daysHeld, positionUsd });
      byKey.set(key, list);
    }
  }

  // Which cohorts clear the bar. Identity is resolved later, for the handful
  // that actually get published — naming thousands of wallets to write a dozen
  // rows would be the expensive way round.
  const chosen: CohortCandidate[] = [];
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
      scan,
      // The same clock `daysHeld` was measured against, so the crossing date in
      // the fingerprint is identical on every run of this job.
      nowMs: now,
    });
    const best = cohorts.find((c) => c.significance >= MIN_SIGNIFICANCE);
    if (best) chosen.push({ marketId, cohort: best });
  }
  return chosen;
}

/** Resolve identity and write. Returns how many rows were published. */
async function publish(db: Db, chosen: CohortCandidate[]): Promise<number> {
  if (chosen.length === 0) return 0;

  const wallets = [...new Set(chosen.flatMap((c) => c.cohort.people.map((p) => p.wallet)))];
  const profiles = await import("@/lib/profiles.server").then((m) =>
    m.resolveProfiles(wallets, 15),
  );

  const nowIso = new Date().toISOString();
  const events = chosen.map(({ marketId, cohort }) => ({
    // ONE definition of the key — the dedup check and the write must never be
    // able to disagree about what "already published" means.
    source_key: sourceKeyFor({ marketId, cohort }),
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

  const { error } = await db
    .from("events")
    .upsert(events, { onConflict: "source_key", ignoreDuplicates: true });
  // Silently discarding this is how three separate features in this codebase
  // reported success while writing nothing.
  if (error) throw new Error(`cohorts: events upsert failed: ${error.message}`);
  return events.length;
}

/**
 * How far the one-time catch-up sweep has got, kept in `calc_cache` (key/value)
 * so it survives restarts and never re-walks ground it has covered.
 */
const CATCHUP_CURSOR_KEY = "cohort_catchup_last_market";
/**
 * Markets inspected per catch-up run. Bounds the read; the pacing cap bounds
 * what gets written. Small enough that catch-up never crowds out the daily pass
 * it shares a cron with.
 */
const CATCHUP_MARKETS_PER_RUN = 150;

async function readCursor(db: Db): Promise<number> {
  const { data } = await db
    .from("calc_cache")
    .select("value")
    .eq("key", CATCHUP_CURSOR_KEY)
    .maybeSingle();
  return num((data as Row | null)?.value);
}

/**
 * ONE-TIME CATCH-UP over history the emitter was never running for.
 *
 * A rung can only be crossed on one specific day. If nothing is watching that
 * day, the moment is gone — there is no later window that finds it. This
 * platform lost every single 7-day crossing exactly that way: the whole index
 * begins on one date (src/domain/tenure), so ~681 markets crossed 7 days
 * together on 2026-07-31, while `emitConvictionCohorts` was still scoped to
 * markets that had recently traded and had never written a row in its life.
 *
 * So this walks every market once, asks who is STANDING at a rung rather than
 * who crossed one today, and publishes what should have been said. It is
 * self-terminating: the cursor only moves forward, and once it passes the
 * highest market id the sweep is over for good.
 *
 * It also, usefully, drains the backlog BEFORE the next mass crossing rather
 * than on top of it — the 30-day rung falls due around 2026-08-23 for that same
 * cohort of markets.
 */
async function emitCatchUp(db: Db, now: number, room: number): Promise<number> {
  if (room <= 0) return 0;
  const cursor = await readCursor(db);

  const { data: markets, error: mErr } = await db
    .from("markets")
    .select("onchain_id")
    .gt("onchain_id", cursor)
    .order("onchain_id", { ascending: true })
    .limit(CATCHUP_MARKETS_PER_RUN);
  if (mErr) throw new Error(`cohorts: catch-up market scan failed: ${mErr.message}`);
  const ids = ((markets ?? []) as Row[]).map((m) => Number(m.onchain_id));
  if (ids.length === 0) return 0; // Swept everything. Nothing more, ever.

  // Only beliefs old enough to have passed the first rung can possibly qualify.
  const oldest = new Date(now - HOLDING_RUNGS[0] * 86_400_000).toISOString();
  const beliefs = await readBeliefs(db, (q) =>
    q
      .select(BELIEF_COLUMNS)
      .in("onchain_id", ids)
      .lt("first_backed_at", oldest)
      .order("first_backed_at", { ascending: true }),
  );

  const candidates = await cohortsFrom(db, beliefs, now, "standing");
  const publishable = await pickUnpublished(db, candidates, room);
  const written = await publish(db, publishable);

  // The cursor advances over the whole slice whether or not it produced
  // anything. Advancing only on success would stall the sweep forever on the
  // first stretch of markets with no qualifying holders — which is most of them.
  await db
    .from("calc_cache")
    .upsert(
      { key: CATCHUP_CURSOR_KEY, value: ids[ids.length - 1], updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
  return written;
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

  const beliefs = await readBeliefs(db, (q) => {
    const base = q
      .select(BELIEF_COLUMNS)
      .or(orFilter)
      // Oldest belief first, so if the page ceiling ever bites it drops the
      // shortest tenures — the ones with the least to say.
      .order("first_backed_at", { ascending: true });
    return marketIds && marketIds.length > 0 ? base.in("onchain_id", marketIds) : base;
  });

  const candidates = await cohortsFrom(db, beliefs, now, "crossing");
  const todays = await pickUnpublished(db, candidates, COHORT.maxPerRun);
  const written = await publish(db, todays);

  // Catch-up spends only what today's crossings left over, so a busy day never
  // becomes a double batch — and a quiet one still makes progress on the sweep.
  // A targeted run is answering a question about specific markets; it should not
  // quietly advance a global cursor.
  const catchUp = marketIds == null ? await emitCatchUp(db, now, COHORT.maxPerRun - written) : 0;
  return written + catchUp;
}
