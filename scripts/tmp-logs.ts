import { getBaseClient } from "../src/chain/client";
import { parseAbiItem } from "viem";
const c = getBaseClient();
const T = "0x10de5da2283ab73b64e0fe3d670c0b653e5705ea" as const;
const w = "0x2eb38b6ebccc6e804ff31b19881268fe67734278" as const;
const ev = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const latest = await c.getBlockNumber();
console.log("latest", latest);
for (const [from,to] of [[49490000n, 49900000n],[49900000n, latest]] as const) {
  let start = from;
  while (start < to) {
    const end = start + 40000n > to ? to : start + 40000n;
    const logs = await c.getLogs({ address: T, event: ev, fromBlock: start, toBlock: end });
    for (const l of logs) console.log(l.blockNumber, l.args.from, "->", l.args.to, String(l.args.value), l.transactionHash);
    start = end + 1n;
  }
}
