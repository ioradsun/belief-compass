/**
 * THE HOME SNAPSHOT — one precomputed, versioned public payload for the front door.
 *
 * Explore, the Insider tape and the first markets' numbers are what a visitor
 * sees the instant the app opens. Each already had its own warm read and its own
 * durable seed (see opportunity-feed.server, insider/seed.server, deck-seed.server),
 * so the SSR loader made THREE reads to paint one screen — and a cold isolate
 * paid three separate Supabase round trips before it could say anything.
 *
 * This module publishes those three as ONE snapshot: a single versioned row the
 * loader reads once. It is PAINT ONLY — Explore is trimmed and marked `partial`,
 * the tape is trimmed, and the client still fetches the live feed/tape right
 * after. Nothing here ranks, aggregates or builds on the request path: a
 * background warmer (/api/public/jobs/tape-warm) rebuilds the snapshot whenever
 * market data changes, and the public endpoint (/api/public/home-snapshot) hands
 * back whatever the warm slot or durable row holds, with an ETag so a CDN or the
 * browser can cache it. Old snapshot while the new one rebuilds; never make the
 * reader wait for freshness.
 *
 * THE DURABLE ROW IS KEYED BY COPY_VERSION, like every other seed in this
 * codebase (see domain/copy-version): a deploy that changes the composed insider
 * sentences must never be able to paint the previous build's copy. `version`
 * guards the shape as well, so a payload written by an older build is ignored
 * rather than mis-read.
 */
import { COPY_VERSION } from "@/domain/copy-version";
import { serviceClientOrNull } from "@/lib/supabase-clients";
import { peekSwr, putSwr, swrCache } from "@/lib/server-cache";
import {
  opportunityFeed,
  type FeedRowPayload,
  type OpportunityFeedResult,
} from "@/lib/opportunity-feed.server";
import { buildTape } from "@/lib/insider/build.server";
import { readMarketChange } from "@/lib/market-core.server";
import { DECK_SEED_MARKETS, type DeckSeed } from "@/lib/deck-seed.server";
import type { TapeResult } from "@/lib/insider/seed.server";

/** Schema version of THIS payload. Bump when the fields below change shape. */
export const HOME_SNAPSHOT_VERSION = 1;

export interface HomeSnapshot {
  /** Payload-shape version — a reader ignores a row it does not understand. */
  version: number;
  /** The build whose copy composed the insider rows — see domain/copy-version. */
  copyVersion: string;
  /** When the snapshot was assembled, ISO 8601. */
  generatedAt: string;
  /**
   * Explore: the first markets and their read-model rows, trimmed and marked
   * `partial`. The client adopts it for paint and still fetches the live feed.
   */
  explore: OpportunityFeedResult | null;
  /** Insider: the first tape rows, trimmed. Paint only; the client refetches. */
  insider: TapeResult | null;
  /** Core numbers for the first few markets, keyed by onchain id. */
  marketCore: DeckSeed | null;
}

/** In-process slot — a warm isolate serves the snapshot with no read at all. */
const SLOT_KEY = "home:snapshot:slot";
/** Durable row — survives cold isolates and deploys; scoped by copy version. */
const ROW_KEY = `home:snapshot:${COPY_VERSION}`;
/** How long a warm-slot copy stays fresh before the next read refills it. */
const SLOT_TTL_MS = 15_000;
/**
 * Markets carried in Explore — a short runway, not the whole feed. Enough that
 * the first screen and a scroll or two are real before the live feed lands.
 */
const EXPLORE_MARKETS = 12;
/** Insider rows carried — enough to fill the column's first screen. */
const INSIDER_ROWS = 12;
/** A read that is not quick is not a snapshot read. Bound the durable read. */
const READ_MS = 700;
/** A persist may never gate the warmer — a slow write is skipped, not awaited. */
const WRITE_MS = 800;

/**
 * Explore for paint: the first markets, their rows, nothing session-specific.
 * `partial: true` is the whole contract — the client refetches the live feed.
 */
function trimExplore(feed: OpportunityFeedResult): OpportunityFeedResult {
  const items = feed.items.filter((i) => i.kind === "market").slice(0, EXPLORE_MARKETS);
  const rows: Record<number, FeedRowPayload> = {};
  for (const it of items) {
    const id = (it as { onchainId: number }).onchainId;
    const row = feed.rows[id];
    if (row) rows[id] = row;
  }
  return {
    ...feed,
    items: items.map((it, n) => ({ ...it, position: n })),
    rows,
    // A ready House idea is a session decision, never a cached one.
    idea: null,
    excluded: [],
    partial: true,
  };
}

function trimInsider(tape: TapeResult): TapeResult {
  return { ...tape, rows: tape.rows.slice(0, INSIDER_ROWS) };
}

/**
 * Stamp already-built pieces into a snapshot. Pure and cheap — the warmer passes
 * what it already computed, so publishing costs no extra queries.
 */
export function assembleHomeSnapshot(parts: {
  explore: OpportunityFeedResult | null;
  insider: TapeResult | null;
  marketCore: DeckSeed | null;
}): HomeSnapshot {
  return {
    version: HOME_SNAPSHOT_VERSION,
    copyVersion: COPY_VERSION,
    generatedAt: new Date().toISOString(),
    explore: parts.explore ? trimExplore(parts.explore) : null,
    // An errored tape is not paintable; leave it out and let the client fetch.
    insider: parts.insider && !parts.insider.error ? trimInsider(parts.insider) : null,
    marketCore:
      parts.marketCore && Object.keys(parts.marketCore).length ? parts.marketCore : null,
  };
}

/**
 * Build the pieces from scratch and assemble them. Used by the public endpoint
 * to self-heal a fresh deploy the warmer has not reached yet; the warmer itself
 * calls `assembleHomeSnapshot` with what it already built.
 */
export async function buildHomeSnapshot(): Promise<HomeSnapshot> {
  const explore = await opportunityFeed({ window: "24h" });
  const ids = explore.items
    .filter((i) => i.kind === "market")
    .slice(0, DECK_SEED_MARKETS)
    .map((i) => (i as { onchainId: number }).onchainId);
  const [insider, cores] = await Promise.all([
    (buildTape({ limit: 120 }) as Promise<TapeResult>).catch(() => null),
    Promise.all(ids.map(async (id) => [String(id), await readMarketChange(id)] as const)).catch(
      () => [] as (readonly [string, DeckSeed[string]])[],
    ),
  ]);
  return assembleHomeSnapshot({ explore, insider, marketCore: Object.fromEntries(cores) });
}

/**
 * Publish a snapshot: warm this isolate now, then persist the durable row.
 *
 * The write is bounded (see WRITE_MS). On the serverless runtime a write
 * belonging to an already-responded request can be cancelled without settling,
 * so awaiting it unbounded inside a warmer could wedge the whole job — the
 * lesson every other seed writer in this codebase already carries.
 */
export async function persistHomeSnapshot(snap: HomeSnapshot): Promise<void> {
  putSwr(SLOT_KEY, snap, SLOT_TTL_MS);
  try {
    const sb = serviceClientOrNull();
    if (!sb) return;
    const write = sb.from("feed_snapshot").upsert(
      {
        key: ROW_KEY,
        payload: snap as unknown as never,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
    await Promise.race([
      Promise.resolve(write).then(() => true),
      new Promise<false>((r) => setTimeout(() => r(false), WRITE_MS)),
    ]);
  } catch {
    // A snapshot that fails to persist must never fail the warmer.
  }
}

async function readHomeSnapshotRow(): Promise<HomeSnapshot | null> {
  try {
    const sb = serviceClientOrNull();
    if (!sb) return null;
    const read = sb.from("feed_snapshot").select("payload").eq("key", ROW_KEY).maybeSingle();
    const res = await Promise.race([
      read,
      new Promise<null>((r) => setTimeout(() => r(null), READ_MS)),
    ]);
    const payload = (res as { data?: { payload?: unknown } } | null)?.data?.payload as
      | HomeSnapshot
      | undefined;
    if (!payload || typeof payload !== "object") return null;
    // Never paint a shape this build cannot read, nor another build's sentences.
    if (payload.version !== HOME_SNAPSHOT_VERSION) return null;
    if (payload.copyVersion !== COPY_VERSION) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * The SSR read: this isolate's warm slot, else the one durable row — NEVER
 * builds. A durable hit warms the slot so the next read on this isolate is free,
 * exactly the arrangement `warmAnonFeed` uses. Returns null only when the
 * snapshot has never been published, and the loader falls back from there.
 */
export async function warmHomeSnapshot(): Promise<HomeSnapshot | null> {
  const warm = peekSwr<HomeSnapshot>(SLOT_KEY);
  if (warm) return warm;
  const row = await readHomeSnapshotRow();
  if (row) putSwr(SLOT_KEY, row, SLOT_TTL_MS);
  return row;
}

/**
 * The endpoint read: warm/durable first, and on a genuine miss (a fresh deploy
 * the warmer has not reached) build ONCE — shared across concurrent callers via
 * the SWR slot — and persist, so the next reader here and in SSR gets a row
 * instead of a build. This may do real work and so is never on the shell's
 * budget; the SSR loader uses `warmHomeSnapshot`, which never builds.
 */
export async function readOrBuildHomeSnapshot(): Promise<HomeSnapshot | null> {
  const warm = await warmHomeSnapshot();
  if (warm) return warm;
  try {
    return await swrCache(SLOT_KEY, { ttlMs: SLOT_TTL_MS }, async () => {
      const snap = await buildHomeSnapshot();
      await persistHomeSnapshot(snap);
      return snap;
    });
  } catch {
    return null;
  }
}

/** A weak ETag over the identity of the payload: shape, copy build, and time. */
export function homeSnapshotETag(snap: HomeSnapshot): string {
  return `W/"hs-${snap.version}-${snap.copyVersion}-${Date.parse(snap.generatedAt) || 0}"`;
}
