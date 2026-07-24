/**
 * POV API client — server only. Never import into client code.
 */
export interface PovMarket {
  onChainMarketId: number;
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
  author?: { walletAddress?: string; displayName?: string; pfpUrl?: string };
  createdAt?: string;
}

export interface PovMarketsPage {
  data?: PovMarket[];
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
    const rows = page.data ?? page.markets ?? [];
    for (const m of rows) yield m;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
}
