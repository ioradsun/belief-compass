import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

// Public Base RPC fallback. mainnet.base.org throttles historical eth_getLogs
// heavily, and free Alchemy Base keys cap eth_getLogs to 10 blocks.
// If BASE_RPC_URL is set to a paid provider (Alchemy paid, QuickNode, etc.),
// prefer it. BASE_RPC_URL_OVERRIDE trumps both.
const PUBLIC_RPC = "https://developer-access-mainnet.base.org";

function pickUrl() {
  if (process.env.BASE_RPC_URL_OVERRIDE) return process.env.BASE_RPC_URL_OVERRIDE;
  const u = process.env.BASE_RPC_URL;
  // Skip Alchemy free-tier keys — 10-block cap makes backfill infeasible.
  if (u && !/alchemy/i.test(u)) return u;
  return PUBLIC_RPC;
}

// Retrying fetch: on 429 / "rate limit" / 5xx, sleep and retry a few times.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryingFetch: typeof fetch = async (input, init) => {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(input, init);
      if (res.status === 429 || res.status >= 500) {
        const backoff = 300 * Math.pow(2, attempt) + Math.random() * 200;
        await sleep(backoff);
        continue;
      }
      return res;
    } catch (e) {
      lastErr = e;
      await sleep(300 * Math.pow(2, attempt));
    }
  }
  throw lastErr ?? new Error("retryingFetch: exhausted retries");
};

export function getBaseClient() {
  const url = pickUrl();
  return createPublicClient({
    chain: base,
    transport: http(url, { batch: false, timeout: 20_000, retryCount: 0, fetchFn: retryingFetch }),
  });
}
