import { getBaseClient } from "../src/chain/client";
const c = getBaseClient();
const abi = [
 {type:"function",name:"getUserBalance",stateMutability:"view",inputs:[{type:"uint256"},{type:"address"}],outputs:[{type:"uint256"},{type:"uint256"}]},
 {type:"function",name:"balanceOf",stateMutability:"view",inputs:[{type:"address"}],outputs:[{type:"uint256"}]},
] as const;
const P="0xd4f4619bb4590598C778178690b77C589b93A3eB" as const;
const w="0x2eb38b6ebccc6e804ff31b19881268fe67734278" as const;
console.log("getUserBalance", await c.readContract({address:P,abi,functionName:"getUserBalance",args:[2743n,w]}));
console.log("erc20", await c.readContract({address:"0x10de5da2283ab73b64e0fe3d670c0b653e5705ea",abi,functionName:"balanceOf",args:[w]}));
