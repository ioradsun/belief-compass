import { buildTape } from "../src/lib/insider/build.server";
const ids = [2776,58,2701,2813,2815,2696,680,2743,2077,60,2794,2814];
async function main(){ const r: any = await buildTape({ limit: 120 } as any);
const rows = r.rows ?? [];
const byMkt = new Map<string, any[]>();
for (const x of rows) { const k = String(x.marketId); if(!byMkt.has(k)) byMkt.set(k,[]); byMkt.get(k)!.push(x); }
console.log("total rows", rows.length, "distinct markets", byMkt.size);
console.log("held markets present in global tape:", ids.filter(i=>byMkt.has(String(i))));
for (const i of ids) {
  const rs = byMkt.get(String(i)) ?? [];
  if (!rs.length) { console.log(`\n#${i}: NO ROW IN GLOBAL TAPE`); continue; }
  console.log(`\n#${i}: ${rs.length} rows`);
  for (const x of rs) console.log("   ", x.kind, "| side", x.side, "| sig", x.mix?.significance?.toFixed?.(2), "| text:", (x.text||x.story?.headline||"").slice(0,110), "| q:", x.question?.text ?? x.story?.question ?? "-");
}
}
main();
