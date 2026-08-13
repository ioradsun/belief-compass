import { keccak256, toHex } from "viem";
import { getBaseClient } from "../src/chain/client";
const cands = [
 "TokensSold(uint256,address,string,bool,uint256,uint256,uint256)",
 "TokensSold(uint256,address,string,bool,uint256,uint256,uint256,uint256)",
 "TokensSold(uint256,address,string,bool,uint256,uint256,uint256,uint256,uint256)",
 "TokensSold(uint256,address,string,bool,uint256,uint256,uint256,uint256,uint256,uint256)",
 "TokensSold(uint256,address,string,bool,uint256,uint256,uint256,uint256,uint256,uint256,uint256)",
];
for (const s of cands) console.log(keccak256(toHex(s)), s);
const c = getBaseClient();
const r = await c.getTransactionReceipt({ hash: "0xcf99ad959024f829c2a34858ed36313d995857fcb6866da2992bb1905730d60f" });
const l = r.logs.find(x=>x.topics[0]==="0x9ba50b18b33edbad2a5afc301fae0eb187a3be2b2449c5a60f98d566221ee0a9")!;
console.log("data words:", (l.data.slice(2).match(/.{64}/g)||[]).map((w,i)=>i+" "+BigInt("0x"+w).toString()));
// implementation slot
const slot = await c.getStorageAt({ address: "0xd4f4619bb4590598C778178690b77C589b93A3eB", slot: "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" });
console.log("impl", slot);
