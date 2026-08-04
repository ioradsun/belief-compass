/**
 * POV API client — server only. Never import into client code.
 */
import {
  assertPovAvailable,
  recordPovFailure,
  recordPovSuccess,
} from "@/lib/pov-health.server";

export interface PovMarket {
  onChainMarketId: number | string;
  id?: string;
  title?: string;
  /** POV page slug — pov.co/markets/{slug}. */
  slug?: string;
  categorySlug?: string;

  agentOpinions?: unknown;
  yesPriceUsd?: number;
  noPriceUsd?: number;
  yesPercentage?: number;
  volumeTotalUsd?: number;
  yesMarketCapUsd?: number;
  noMarketCapUsd?: number;
  volume24hUsd?: number;
  boostScore?: number;
  trendingScore?: number;
  author?: { walletAddress?: string; username?: string; displayName?: string; pfpUrl?: string };
  createdAt?: string;
}

export interface PovMarketsPage {
  data?: PovMarket[];
  items?: PovMarket[];
  markets?: PovMarket[];
  nextCursor?: string | null;
}

const BASE = () => process.env.POV_API_BASE || "https://core.pov.co/api";

/**
 * Every POV request goes through here so a provider outage is detected once and
 * then short-circuited (see pov-health.server.ts) instead of costing every
 * caller a full timeout. 404 is a normal answer, not a failure.
 */
async function povFetch(url: string | URL, timeoutMs = 8000): Promise<Response> {
  assertPovAvailable();
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    recordPovFailure(e);
    throw e;
  }
  if (res.status >= 500 || res.status === 429) {
    const body = await res.text().catch(() => "");
    const err = new Error(`POV ${res.status}: ${body.slice(0, 200)}`);
    recordPovFailure(err);
    throw err;
  }
  recordPovSuccess();
  return res;
}

export async function fetchMarketsPage(cursor?: string): Promise<PovMarketsPage> {
  const u = new URL(`${BASE()}/markets`);
  if (cursor) u.searchParams.set("cursor", cursor);
  const res = await povFetch(u, 15_000);
  if (!res.ok) throw new Error(`POV /markets ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function* iterateAllMarkets(): AsyncGenerator<PovMarket> {
  let cursor: string | undefined;
  do {
    const page = await fetchMarketsPage(cursor);
    const rows = page.data ?? page.items ?? page.markets ?? [];
    for (const m of rows) yield m;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
}

export interface PovUser {
  walletAddress: string;
  username?: string;
  displayName?: string;
  pfpUrl?: string;
  twitterId?: string;
}

/** One row from POV /users/{wallet}/positions — the wallet's current holding. */
export interface PovPosition {
  marketId: string; // POV market uuid (maps to markets.pov_uuid)
  side: "YES" | "NO";
  tokenBalance: number; // current shares held
  currentValueUsd: number; // POV's own live valuation of this side
}

interface PovPositionsPage {
  items?: Array<Record<string, unknown>>;
  data?: Array<Record<string, unknown>>;
  hasMore?: boolean;
}

const POV_POSITIONS_PAGE = 50; // POV caps `limit` at 50
const POV_POSITIONS_MAX_PAGES = 40; // safety bound (≤2000 positions)

/**
 * All of a wallet's current positions from POV — the source of truth for what
 * they hold right now (side + shares + value), one row per (market, side). POV
 * is the authority here; we do not reconstruct this from chain logs. Paginates
 * defensively: stops on hasMore=false, a short page, or an offset that yields no
 * new (market, side) rows (guards an ignored offset). Returns [] on 404/no account.
 */
export async function fetchPovPositions(wallet: string, timeoutMs = 8000): Promise<PovPosition[]> {
  const out: PovPosition[] = [];
  const seen = new Set<string>();
  for (
    let offset = 0, page = 0;
    page < POV_POSITIONS_MAX_PAGES;
    offset += POV_POSITIONS_PAGE, page++
  ) {
    const u = `${BASE()}/users/${encodeURIComponent(wallet)}/positions?limit=${POV_POSITIONS_PAGE}&offset=${offset}`;
    const res = await povFetch(u, timeoutMs);
    if (res.status === 404) break;
    if (!res.ok) throw new Error(`POV /positions ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as PovPositionsPage;
    const items = body.items ?? body.data ?? [];
    let added = 0;
    for (const it of items) {
      const marketId = String(it.marketId ?? "");
      const side = String(it.side ?? "").toUpperCase() === "YES" ? "YES" : "NO";
      const key = `${marketId}:${side}`;
      if (!marketId || seen.has(key)) continue;
      seen.add(key);
      added++;
      out.push({
        marketId,
        side,
        tokenBalance: Number(it.tokenBalance ?? 0),
        currentValueUsd: Number(it.currentValueUsd ?? 0),
      });
    }
    if (body.hasMore !== true || items.length < POV_POSITIONS_PAGE || added === 0) break;
  }
  return out;
}

/**
 * Resolve a single wallet to its POV profile. Returns null when the wallet has
 * no POV account (the API answers 404), so callers can cache the miss and fall
 * back to a generated identity. `timeoutMs` bounds a slow lookup.
 */
export async function fetchPovUser(wallet: string, timeoutMs = 8000): Promise<PovUser | null> {
  const u = `${BASE()}/users/${encodeURIComponent(wallet)}`;
  const res = await povFetch(u, timeoutMs);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`POV /users ${res.status}: ${await res.text()}`);
  return res.json();
}
