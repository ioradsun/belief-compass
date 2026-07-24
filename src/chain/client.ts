import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

export function getBaseClient() {
  const url = process.env.BASE_RPC_URL;
  if (!url) throw new Error("BASE_RPC_URL not configured");
  return createPublicClient({ chain: base, transport: http(url, { batch: true, timeout: 20_000 }) });
}
