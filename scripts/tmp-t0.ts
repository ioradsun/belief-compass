import { keccak256, toHex } from "viem";
const b="TokensBought(uint256,address,string,bool,uint256,uint256,uint256,uint256,uint256,uint256,uint256)";
console.log(keccak256(toHex(b)));
