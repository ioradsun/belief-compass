/**
 * ABI-pinned trade decoder for the POV market contract on Base (chainid 8453).
 * Source of truth: src/chain/abi.json + abi.meta.json (pinned at build).
 *
 * Fails LOUDLY at module load if the required events aren't present —
 * spec forbids guessing event shapes.
 */
import { decodeEventLog, parseAbiItem, type Log, type Hex } from "viem";
import abi from "./abi.json" with { type: "json" };
import meta from "./abi.meta.json" with { type: "json" };

type AbiEvent = { type: "event"; name: string; inputs: { name: string; type: string; indexed?: boolean }[] };

const EVENTS = (abi as unknown as AbiEvent[]).filter((x) => x.type === "event");

const REQUIRED = ["TokensBought", "TokensSold"] as const;
for (const name of REQUIRED) {
  const evt = EVENTS.find((e) => e.name === name);
  if (!evt) {
    throw new Error(
      `[chain/decoder] ABI missing required event "${name}" — refusing to guess. ` +
      `Re-pin ABI for impl ${meta.impl_address} on chain ${meta.chain_id}.`,
    );
  }
  // Sanity-check the required fields exist.
  const need = name === "TokensBought"
    ? ["marketId", "buyer", "yes", "amount", "ethSpent"]
    : ["marketId", "seller", "yes", "amount", "proceeds"];
  for (const f of need) {
    if (!evt.inputs.find((i) => i.name === f)) {
      throw new Error(`[chain/decoder] Event ${name} missing field "${f}". ABI drift.`);
    }
  }
}

export const PROXY_ADDRESS = meta.proxy_address.toLowerCase() as `0x${string}`;
export const CHAIN_ID = meta.chain_id;
export const ABI = abi as unknown as readonly AbiEvent[];
export const TRADE_EVENTS = [
  parseAbiItem("event TokensBought(uint256 indexed marketId, address indexed buyer, string questionId, bool yes, uint256 amount, uint256 ethSpent, uint256 fee, uint256 agentFee, uint256 creatorFee, uint256 treasuryFee, uint256 newPrice)"),
  parseAbiItem("event TokensSold(uint256 indexed marketId, address indexed seller, string questionId, bool yes, uint256 amount, uint256 proceeds, uint256 newPrice)"),
] as const;

export interface CanonicalTrade {
  tx_hash: string;
  log_index: number;
  block_number: number;
  block_hash: string;
  onchain_id: string;   // uint256 as decimal string
  wallet: string;       // lowercase hex
  side: "YES" | "NO";
  direction: "BUY" | "SELL";
  token_amount: string; // decimal string (wei of belief-token)
  eth_amount: string;   // decimal string (wei ETH)
  price: string | null; // post-trade price (newPrice), decimal string; null if absent
  raw_log: unknown;
}

export function decodeTradeLog(log: Log): CanonicalTrade | null {
  try {
    const decoded = decodeEventLog({
      abi: ABI as never,
      data: log.data,
      topics: log.topics,
      strict: false,
    }) as unknown as { eventName: string; args: Record<string, unknown> };

    if (decoded.eventName !== "TokensBought" && decoded.eventName !== "TokensSold") {
      return null;
    }
    const a = decoded.args;
    const isBuy = decoded.eventName === "TokensBought";
    const wallet = (isBuy ? a.buyer : a.seller) as Hex;
    const yes = a.yes as boolean;
    const amount = a.amount as bigint;
    const eth = (isBuy ? a.ethSpent : a.proceeds) as bigint;
    const marketId = a.marketId as bigint;
    const newPrice = a.newPrice as bigint | undefined;

    return {
      tx_hash: log.transactionHash!,
      log_index: log.logIndex!,
      block_number: Number(log.blockNumber!),
      block_hash: log.blockHash!,
      onchain_id: marketId.toString(),
      wallet: (wallet as string).toLowerCase(),
      side: yes ? "YES" : "NO",
      direction: isBuy ? "BUY" : "SELL",
      token_amount: amount.toString(),
      eth_amount: eth.toString(),
      price: newPrice != null ? newPrice.toString() : null,
      raw_log: { address: log.address, topics: log.topics, data: log.data },
    };
  } catch {
    return null;
  }
}
