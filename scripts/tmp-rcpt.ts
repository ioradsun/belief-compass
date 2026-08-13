import { getBaseClient } from "../src/chain/client";
const c = getBaseClient();
for (const h of ["0xcf99ad959024f829c2a34858ed36313d995857fcb6866da2992bb1905730d60f","0x30d4287bc52f31d9a46346d5647a87249df0b8498def3ed5296f24bf445165d6","0xb5e84fbae7e79ff9d2a00ea491b9ea23f731ecfbe0ccc7495d68234595120abc"] as const) {
  const r = await c.getTransactionReceipt({ hash: h });
  console.log(h, r.status);
  for (const l of r.logs) if (l.address.toLowerCase()==="0xd4f4619bb4590598c778178690b77c589b93a3eb") console.log("  topic0", l.topics[0], "topics", l.topics.length, "idx", l.logIndex);
}
