/**
 * POV API client — server only. Never import into client code.
 */
export interface PovMarket {
  onChainMarketId: number | string;
  id?: string;
  title?: string;
  categorySlug?: string;
  agentOpinions?: unknown;
  yesPriceUsd?: number;
  noPriceUsd?: number;
  yesPercentage?: number;
  volumeTotalUsd?: number;
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

export async function fetchMarketsPage(cursor?: string): Promise<PovMarketsPage> {
  const u = new URL(`${BASE()}/markets`);
  if (cursor) u.searchParams.set("cursor", cursor);
  const res = await fetch(u, { headers: { accept: "application/json" } });
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

/**
 * Resolve a single wallet to its POV profile. Returns null when the wallet has
 * no POV account (the API answers 404), so callers can cache the miss and fall
 * back to a generated identity. `timeoutMs` bounds a slow lookup.
 */
export async function fetchPovUser(wallet: string, timeoutMs = 8000): Promise<PovUser | null> {
  const u = `${BASE()}/users/${encodeURIComponent(wallet)}`;
  const res = await fetch(u, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`POV /users ${res.status}: ${await res.text()}`);
  return res.json();
}
