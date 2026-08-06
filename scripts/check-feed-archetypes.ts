/**
 * check-feed-archetypes — read the feed the way a person would, for nine people.
 *
 * WHY THIS EXISTS. The candidate pool went from 50 markets to 164 and the
 * momentum signal stopped measuring the exchange rate. Both are large changes to
 * what the ranker SEES, and a ranking can be arithmetically perfect and still
 * produce a feed nobody wants to read. Unit tests pin the rules; only reading
 * the output tells you whether the result is interesting.
 *
 * WHAT IS REAL AND WHAT IS SYNTHETIC — stated up front, because a harness that
 * blurs this certifies the wrong thing:
 *
 *   REAL       the candidate pool, every market_state field the ranker reads,
 *              the five slice queries, buildPool, scoreMarket, reasonFor,
 *              sequenceFeed, the momentum classifier and the currency drift.
 *              This is the production pipeline, not a model of it.
 *
 *   SYNTHETIC  the VIEWER. `wallet_beliefs` and `viewer_dna_cache` are
 *              service-role only, so tribe/rival/follow presence and the
 *              affinity profile are generated deterministically over the real
 *              market ids. The archetypes therefore test how the engine RESPONDS
 *              to a shape of viewer — they do not validate the real distribution
 *              of viewer shapes, and nothing here should be read as doing so.
 *
 *   MISSING    market_ai_analysis is not read (embeddings, duplicate clusters,
 *              quality scores). `quality` therefore sits at its neutral default
 *              and `semantic_duplicate` never fires. Both are called out in the
 *              output rather than silently absent.
 *
 * RUNS AS THE APP DOES — publishable key, not service role. A checker with more
 * access than the thing it checks will certify a broken system; this repo has
 * already been bitten by exactly that (see check-feed-supply).
 *
 * Run:  npx tsx scripts/check-feed-archetypes.ts [--rows 12] [--archetype crypto]
 * Env:  SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY (or VITE_ / _ANON_ variants)
 */
import { createClient } from "@supabase/supabase-js";
import { buildPool, POOL, type PoolSlice } from "../src/domain/feed/pool";
import { scoreMarket, type FeedMarketSignals, type ViewerProfile } from "../src/domain/feed/score";
import { reasonFor, familyOf } from "../src/domain/feed/reasons";
import { sequenceFeed, type SequenceCandidate } from "../src/domain/feed/sequence";
import { eligibilityFor } from "../src/domain/feed/eligibility";
import { classifyMomentum, type MomentumFacts } from "../src/domain/feed/momentum";
import { currencyDrift, marketChange, type MarketChange } from "../src/domain/market-change";
import { WEIGHTS } from "../src/domain/feed/config";

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key =
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.SUPABASE_ANON_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : fallback;
};
const ROWS = Math.max(1, Number(arg("rows", "12")));
const ONLY = arg("archetype", "");

const FEED_COLUMNS = `
  onchain_id, yes_price_usd, no_price_usd, money_yes_pct, people_yes_pct, people_no_pct,
  believers_yes, believers_no, believers_mixed, directional_believers, divergence,
  volume_total_usd, trending_score, yes_capital_usd, no_capital_usd,
  new_believers_1h, new_believers_24h, new_believers_7d,
  new_believers_yes_24h, new_believers_no_24h,
  yes_capital_delta_24h, no_capital_delta_24h,
  unique_wallets_1h, unique_wallets_24h, circulation_24h,
  trade_count_1h, trade_count_24h, trade_count_7d,
  market_created_at, first_trade_at, last_trade_at, inactive_for_seconds, velocity_5m,
  side_flips_24h, opportunity_type, opportunity_score, opportunity_reason, opportunity_eligible,
  markets:onchain_id ( title, category, author_wallet )
`;

type Row = Record<string, unknown> & { onchain_id: number };
const num = (v: unknown): number => (Number.isFinite(Number(v)) ? Number(v) : 0);
const nOrNull = (v: unknown): number | null =>
  v == null || !Number.isFinite(Number(v)) ? null : Number(v);

// ── the real pool ───────────────────────────────────────────────────────────

async function loadPool() {
  const q = () => sb.from("market_state").select(FEED_COLUMNS);
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const t0 = Date.now();
  const [active, fresh, classified, believed, deep] = await Promise.all([
    q()
      .gte("last_trade_at", since)
      .order("last_trade_at", { ascending: false, nullsFirst: false })
      .limit(POOL.slices.active.fetch),
    q()
      .order("market_created_at", { ascending: false, nullsFirst: false })
      .limit(POOL.slices.fresh.fetch),
    q()
      .not("opportunity_type", "is", null)
      .order("opportunity_score", { ascending: false, nullsFirst: false })
      .limit(POOL.slices.classified.fetch),
    q()
      .gt("directional_believers", 0)
      .order("directional_believers", { ascending: false, nullsFirst: false })
      .limit(POOL.slices.believed.fetch),
    q()
      .order("volume_total_usd", { ascending: false, nullsFirst: false })
      .limit(POOL.slices.deep.fetch),
  ]);
  const queryMs = Date.now() - t0;

  const results = { active, fresh, classified, believed, deep };
  const bySlice: Partial<Record<PoolSlice, (Row & { onchainId: number })[]>> = {};
  let bytes = 0;
  for (const [slice, r] of Object.entries(results) as [PoolSlice, typeof active][]) {
    if (r.error) console.error(`  slice ${slice} failed: ${r.error.message}`);
    const rows = (r.data ?? []) as unknown as Row[];
    bytes += JSON.stringify(rows).length;
    bySlice[slice] = rows.map((row) => ({ ...row, onchainId: Number(row.onchain_id) }));
  }
  const pool = buildPool({ bySlice });
  return { pool, queryMs, bytes };
}

/**
 * The 24h baseline, from the same snapshot history the app reads.
 *
 * `market_window_baselines_bulk` is an RPC the anon role may not execute, so
 * this reads the snapshot table directly in a band — the same shape the bulk RPC
 * produces. If it comes back empty the run says so rather than quietly reporting
 * a platform where nothing ever moves.
 */
async function loadBaselines(ids: number[]): Promise<Map<number, Record<string, unknown>>> {
  const out = new Map<number, Record<string, unknown>>();
  const lo = new Date(Date.now() - 26 * 3_600_000).toISOString();
  const hi = new Date(Date.now() - 24 * 3_600_000).toISOString();
  for (let i = 0; i < ids.length; i += 60) {
    const { data, error } = await sb
      .from("market_state_snapshots")
      .select(
        "onchain_id, captured_at, believers_yes, believers_no, yes_capital_usd, no_capital_usd, yes_price_usd, no_price_usd",
      )
      .in("onchain_id", ids.slice(i, i + 60))
      .gte("captured_at", lo)
      .lte("captured_at", hi)
      .order("captured_at", { ascending: false })
      .limit(5000);
    if (error) continue;
    for (const s of (data ?? []) as Record<string, unknown>[]) {
      const id = Number(s.onchain_id);
      if (!out.has(id)) out.set(id, s);
    }
  }
  return out;
}

const changeOf = (r: Row, base: Record<string, unknown> | undefined): MarketChange =>
  marketChange(
    {
      yes: {
        believers: nOrNull(r.believers_yes),
        capitalUsd: nOrNull(r.yes_capital_usd),
        priceUsd: nOrNull(r.yes_price_usd),
      },
      no: {
        believers: nOrNull(r.believers_no),
        capitalUsd: nOrNull(r.no_capital_usd),
        priceUsd: nOrNull(r.no_price_usd),
      },
    },
    base
      ? {
          yes: {
            believers: nOrNull(base.believers_yes),
            capitalUsd: nOrNull(base.yes_capital_usd),
            priceUsd: nOrNull(base.yes_price_usd),
          },
          no: {
            believers: nOrNull(base.believers_no),
            capitalUsd: nOrNull(base.no_capital_usd),
            priceUsd: nOrNull(base.no_price_usd),
          },
        }
      : null,
    "24h",
  );

// ── synthetic viewers ───────────────────────────────────────────────────────

/**
 * A viewer, described by SHAPE rather than by identity.
 *
 * Each archetype says which markets its people are in and what it has an
 * affinity for, as a function of the real pool — so the same archetype produces
 * a comparable feed as the platform's data changes underneath it.
 */
interface Archetype {
  key: string;
  what: string;
  /** Which pool markets this viewer's aligned people hold a side in. */
  tribe?: (r: Row, i: number) => boolean;
  /** …and their opposed people. */
  opp?: (r: Row, i: number) => boolean;
  /** …and the people they explicitly follow. */
  follows?: (r: Row, i: number) => boolean;
  categoryAffinity?: Record<string, number>;
  /** Markets this viewer has already seen — drives the `unseen` freshness term. */
  seenFraction?: number;
}

const cat = (r: Row): string =>
  String((r.markets as { category?: string } | null)?.category ?? "other").toLowerCase();

const ARCHETYPES: Archetype[] = [
  { key: "new", what: "brand-new viewer — no history, no network, nothing seen" },
  {
    key: "crypto",
    what: "crypto-heavy viewer",
    categoryAffinity: { crypto: 0.9, defi: 0.6, ai: 0.2 },
    seenFraction: 0.2,
  },
  {
    key: "culture",
    what: "culture-heavy viewer",
    categoryAffinity: { culture: 0.9, politics: 0.4 },
    seenFraction: 0.2,
  },
  {
    key: "broad",
    what: "broad participation — some affinity everywhere",
    categoryAffinity: { crypto: 0.4, culture: 0.4, sports: 0.4, ai: 0.4, politics: 0.4 },
    seenFraction: 0.35,
  },
  {
    key: "tribe",
    what: "strong tribe overlap — aligned people in a third of the pool",
    tribe: (_r, i) => i % 3 === 0,
    categoryAffinity: { crypto: 0.3 },
    seenFraction: 0.2,
  },
  {
    key: "rivals",
    what: "strong rival overlap — opposed people in a third of the pool",
    opp: (_r, i) => i % 3 === 1,
    categoryAffinity: { crypto: 0.3 },
    seenFraction: 0.2,
  },
  {
    key: "follower",
    what: "creator follower — follows whoever wrote the most markets here",
    follows: () => false, // replaced at runtime once the top creator is known
    seenFraction: 0.1,
  },
  {
    key: "stranger",
    what: "no shared markets — has history, but none of it overlaps the pool",
    categoryAffinity: { sports: 0.8 },
    seenFraction: 0,
  },
  {
    key: "active",
    what: "highly active wallet — has seen most of the pool already",
    tribe: (_r, i) => i % 5 === 0,
    opp: (_r, i) => i % 7 === 0,
    follows: (_r, i) => i % 11 === 0,
    categoryAffinity: { crypto: 0.6, ai: 0.5, culture: 0.3 },
    seenFraction: 0.75,
  },
];

// ── the pipeline, per archetype ─────────────────────────────────────────────

/**
 * The family map lives in the domain (see reasons.ts#familyOf) and this reads
 * it. A local copy would let the measurement and the diversity rule that acts on
 * it drift apart — which is how a harness ends up certifying the wrong thing.
 */

function signalsOf(
  r: Row,
  a: Archetype,
  i: number,
  momentum: MomentumFacts,
  windowVolumeUsd: number,
): FeedMarketSignals {
  const meta = (r.markets ?? null) as { category?: string; author_wallet?: string } | null;
  const inTribe = a.tribe?.(r, i) ?? false;
  const inOpp = a.opp?.(r, i) ?? false;
  const followed = a.follows?.(r, i) ?? false;
  return {
    onchainId: Number(r.onchain_id),
    category: meta?.category ?? null,
    creator: meta?.author_wallet ? String(meta.author_wallet).toLowerCase() : null,
    createdAt: (r.market_created_at as string | null) ?? null,
    newBelievers1h: num(r.new_believers_1h),
    newBelievers24h: num(r.new_believers_24h),
    tradeCount1h: num(r.trade_count_1h),
    tradeCount24h: num(r.trade_count_24h),
    uniqueWallets1h: num(r.unique_wallets_1h),
    uniqueWallets24h: num(r.unique_wallets_24h),
    velocity5m: num(r.velocity_5m),
    volumeUsd24h: windowVolumeUsd,
    directionalBelievers: num(r.directional_believers),
    divergence: num(r.divergence),
    priceMovePct: 0,
    momentumWeight: momentum.weight,
    opportunityType: (r.opportunity_type as string | null) ?? null,
    opportunityReason: (r.opportunity_reason as string | null) ?? null,
    opportunityScore: nOrNull(r.opportunity_score),
    opportunityEligible: Boolean(r.opportunity_eligible),
    tribeSide: inTribe ? (i % 2 === 0 ? "YES" : "NO") : null,
    oppSide: inOpp ? (i % 2 === 0 ? "NO" : "YES") : null,
    tribeCount: inTribe ? 1 + (i % 3) : 0,
    oppCount: inOpp ? 1 + (i % 2) : 0,
    followedHere: followed ? 1 : 0,
    followedYes: followed ? 1 : 0,
    followedNo: 0,
    followedNames: followed ? ["a followed person"] : [],
    connectedToOrigin: 0,
    hasMedia: false,
  };
}

interface Placed {
  position: number;
  onchainId: number;
  title: string;
  category: string;
  score: number;
  reason: string | null;
  reasonCode: string | null;
  family: string;
  driver: string;
  components: Record<string, number>;
  slices: string[];
  momentumDir: string;
  ageHours: number | null;
  capitalUsd: number;
  believers: number;
  adjustments: string[];
  displaced: { onchainId: number; score: number; why: string }[];
}

function ageBand(h: number | null): string {
  if (h == null) return "?";
  if (h < 72) return "new";
  if (h < 24 * 30) return "recent";
  return "old";
}
function sizeBand(usd: number): string {
  if (usd < 1) return "dust";
  if (usd < 50) return "small";
  if (usd < 500) return "mid";
  return "large";
}

async function main() {
  console.log("\n=== FEED ARCHETYPES ===");
  console.log("Real pool + real engine. Viewers are synthetic — see the header.\n");

  const { pool, queryMs, bytes } = await loadPool();
  const rows = pool.markets.map((m) => m.row);
  const slicesById = new Map(pool.markets.map((m) => [m.row.onchainId, m.slices]));
  const ids = rows.map((r) => Number(r.onchain_id));
  console.log(
    `POOL  ${rows.length} markets  ·  5 slice queries in ${queryMs}ms  ·  ${(bytes / 1024).toFixed(0)}KB raw`,
  );
  const kept = pool.kept;
  console.log(
    `      ${(Object.keys(kept) as PoolSlice[]).map((s) => `${s} ${kept[s]}`).join("  ·  ")}`,
  );

  const tB = Date.now();
  const baselines = await loadBaselines(ids);
  console.log(
    `BASE  24h baseline for ${baselines.size}/${ids.length} markets in ${Date.now() - tB}ms`,
  );
  if (baselines.size === 0) {
    console.log("      !! no baselines — every market will look still. Momentum is untested.");
  }

  // Change + drift + momentum: the shared, viewer-independent layer.
  const changes = new Map<number, MarketChange>();
  for (const r of rows)
    changes.set(Number(r.onchain_id), changeOf(r, baselines.get(Number(r.onchain_id))));
  const drift = currencyDrift(ids.map((id) => changes.get(id)?.yes.price.pct ?? null));
  const momentumById = new Map<number, MomentumFacts>();
  for (const r of rows) {
    const id = Number(r.onchain_id);
    momentumById.set(
      id,
      classifyMomentum(
        changes.get(id) ?? null,
        {
          window: "24h",
          believersYes: num(r.believers_yes),
          believersNo: num(r.believers_no),
          moneyYesShare: r.money_yes_pct == null ? null : num(r.money_yes_pct) / 100,
          inactiveForSeconds: nOrNull(r.inactive_for_seconds),
          tradedInWindow: num(r.trade_count_24h) > 0,
        },
        drift,
      ),
    );
  }
  const moving = [...momentumById.values()].filter((m) => m.lenses.length > 0).length;
  console.log(
    `DRIFT ${drift == null ? "not measurable" : `${drift.toFixed(2)}% (the currency)`}  ·  ${moving}/${rows.length} markets in any momentum lens\n`,
  );

  // The `follower` archetype needs the pool's most prolific creator.
  const byCreator = new Map<string, number>();
  for (const r of rows) {
    const w = (r.markets as { author_wallet?: string } | null)?.author_wallet;
    if (w) byCreator.set(w, (byCreator.get(w) ?? 0) + 1);
  }
  const topCreator = [...byCreator.entries()].sort((a, b) => b[1] - a[1])[0];
  const follower = ARCHETYPES.find((a) => a.key === "follower")!;
  follower.follows = (r) =>
    (r.markets as { author_wallet?: string } | null)?.author_wallet === topCreator?.[0];
  follower.what = `creator follower — follows the author of ${topCreator?.[1] ?? 0} pool markets`;

  let scoreMsTotal = 0;
  const list = ONLY ? ARCHETYPES.filter((a) => a.key === ONLY) : ARCHETYPES;

  for (const a of list) {
    const t0 = Date.now();
    const viewer: ViewerProfile = {
      categoryAffinity: a.categoryAffinity ?? {},
      topicAffinity: {},
      creatorAffinity: {},
      tasteEmbedding: null,
      neverShown: new Set(
        ids.filter((_, i) => i >= Math.floor(ids.length * (a.seenFraction ?? 0))),
      ),
    };
    const seen = new Set(ids.filter((_, i) => i < Math.floor(ids.length * (a.seenFraction ?? 0))));

    const candidates: SequenceCandidate[] = rows.map((r, i) => {
      const id = Number(r.onchain_id);
      const mo = momentumById.get(id)!;
      const capital = num(r.yes_capital_usd) + num(r.no_capital_usd);
      const s = signalsOf(r, a, i, mo, capital);
      const scored = scoreMarket({ signals: s, viewer, now: Date.now(), epoch: 0 });
      return {
        onchainId: id,
        category: s.category,
        creator: s.creator,
        clusterId: null,
        scored,
        // The viewer has SEEN some markets but acted on none; an acted-on market
        // is a cooldown this harness cannot synthesise honestly.
        eligibility: eligibilityFor({
          onchainId: id,
          state: undefined,
          sessionSeen: seen,
          sessionQueued: new Set(),
          now: Date.now(),
        }),
        reason: reasonFor(s, scored, { category: s.category, momentum: mo, window: "24h" }),
        reentry: null,
        poolSlices: slicesById.get(id) ?? [],
        moveDirection: mo.top?.direction ?? null,
      };
    });

    const { items } = sequenceFeed({ candidates, limit: ROWS });
    scoreMsTotal += Date.now() - t0;

    const placed: Placed[] = items.flatMap((it) => {
      if (it.kind !== "market") return [];
      const r = rows.find((x) => Number(x.onchain_id) === it.onchainId)!;
      const mo = momentumById.get(it.onchainId)!;
      const d = it.diagnostics;
      return [
        {
          position: it.position,
          onchainId: it.onchainId,
          title: String((r.markets as { title?: string } | null)?.title ?? `#${it.onchainId}`),
          category: cat(r),
          score: it.score,
          reason: it.primaryReason,
          reasonCode: it.reasonCode,
          family: familyOf(it.reasonCode as never) ?? "—",
          driver: d.driver,
          components: d.components as unknown as Record<string, number>,
          slices: d.poolSlices,
          momentumDir: mo.top ? `${mo.top.direction} ${mo.top.metric}` : (mo.lenses[0] ?? "still"),
          ageHours: d.ageHours,
          capitalUsd: num(r.yes_capital_usd) + num(r.no_capital_usd),
          believers: num(r.directional_believers),
          adjustments: d.diversityAdjustments,
          displaced: d.displaced,
        },
      ];
    });

    report(a, placed);
  }

  console.log(`\nTIMING  scoring+sequencing ${scoreMsTotal}ms for ${list.length} archetypes`);
  console.log("        (viewer DNA overlay is service-role and NOT measured here)");
  console.log("NOTE    market_ai_analysis not read: `quality` is at its neutral");
  console.log("        default and `semantic_duplicate` cannot fire in this run.\n");
}

function pctOf(n: number, total: number): string {
  return total === 0 ? "0%" : `${Math.round((n / total) * 100)}%`;
}

function report(a: Archetype, placed: Placed[]) {
  console.log("─".repeat(100));
  console.log(`${a.key.toUpperCase()}  —  ${a.what}`);
  console.log("─".repeat(100));

  for (const p of placed) {
    const top = Object.entries(p.components)
      .map(([k, v]) => [k, (WEIGHTS[k as keyof typeof WEIGHTS] ?? 0) * v] as const)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 3)
      .map(([k, v]) => `${k} ${v.toFixed(3)}`)
      .join(", ");
    console.log(
      `\n${String(p.position).padStart(2)}. [${p.score.toFixed(1)}] ${p.title.slice(0, 62)}`,
    );
    console.log(`    reason   ${p.reason ?? "(none)"}  ·  ${p.family}/${p.reasonCode ?? "—"}`);
    console.log(`    signals  driver=${p.driver}  ${top}`);
    console.log(
      `    market   ${p.category} · ${ageBand(p.ageHours)} (${p.ageHours == null ? "?" : Math.round(p.ageHours) + "h"}) · ${sizeBand(p.capitalUsd)} ($${p.capitalUsd.toFixed(2)}) · ${p.believers} believers · ${p.momentumDir}`,
    );
    console.log(`    pool     ${p.slices.join("+") || "—"}`);
    if (p.adjustments.length) console.log(`    adjusted ${p.adjustments.join(", ")}`);
    if (p.displaced.length) {
      for (const d of p.displaced) {
        console.log(`    passed   #${d.onchainId} [${d.score.toFixed(1)}] — ${d.why}`);
      }
    }
  }

  // ── the clustering check the diversity work depends on ────────────────────
  const n = placed.length;
  const count = <T>(xs: T[]) => {
    const m = new Map<T, number>();
    for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const runs = <T>(xs: T[]) => {
    let best = 1;
    let cur = 1;
    for (let i = 1; i < xs.length; i += 1) {
      cur = xs[i] === xs[i - 1] ? cur + 1 : 1;
      best = Math.max(best, cur);
    }
    return xs.length ? best : 0;
  };

  const cats = placed.map((p) => p.category);
  const ages = placed.map((p) => ageBand(p.ageHours));
  const sizes = placed.map((p) => sizeBand(p.capitalUsd));
  const dirs = placed.map((p) => p.momentumDir.split(" ")[0]!);
  const fams = placed.map((p) => p.family);
  const slices = placed.flatMap((p) => p.slices);

  console.log(`\n    ── shape of this feed (${n} cards) ──`);
  const line = (label: string, entries: [string, number][], longest: number) =>
    console.log(
      `    ${label.padEnd(9)} ${entries
        .slice(0, 4)
        .map(([k, v]) => `${k} ${pctOf(v, n)}`)
        .join("  ")}${longest > 1 ? `   longest run ${longest}` : ""}`,
    );
  line("category", count(cats), runs(cats));
  line("age", count(ages), runs(ages));
  line("size", count(sizes), runs(sizes));
  line("direction", count(dirs), runs(dirs));
  line("family", count(fams), runs(fams));
  console.log(
    `    pool      ${count(slices)
      .map(([k, v]) => `${k} ${v}`)
      .join("  ")}`,
  );
  const noReason = placed.filter((p) => !p.reason).length;
  console.log(
    `    unexplained ${noReason}/${n} cards have no reason${noReason ? "  <-- every card should have one" : ""}`,
  );
  console.log("");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
