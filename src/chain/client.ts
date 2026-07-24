import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

// Public Base RPC supports eth_getLogs across 10,000-block ranges, which the
// current BASE_RPC_URL (Alchemy free tier) does not (10-block cap). Prefer
// the public endpoint for indexing; expose an explicit override for later.
const PUBLIC_RPC = "https://mainnet.base.org";

export function getBaseClient() {
  const url = process.env.BASE_RPC_URL_OVERRIDE || PUBLIC_RPC;
  return createPublicClient({ chain: base, transport: http(url, { batch: true, timeout: 20_000 }) });
}
