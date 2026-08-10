import { buildTape } from "../../src/lib/insider/build.server";
const W = "0x2eb38b6ebccc6e804ff31b19881268fe67734278";
const ids = [2776,58,2701,2813,2815,2696,680,2743,2077,60,2794,2814];
function dump(tag:string, rows:any[]) {
  const by = new Map<string, any[]>();
  for (const x of rows) { const k=String(x.marketId); (by.get(k) ?? by.set(k,[]).get(k)!).push(x); }
  console.log(`\n===== ${tag}: ${rows.length} rows / ${by.size} markets; held present: ${ids.filter(i=>by.has(String(i))).join(",")||"none"}`);
  for (const i of ids) for (const x of (by.get(String(i))??[]))
    console.log(`  #${i} ${x.kind} side=${x.side} sig=${x.mix?.significance?.toFixed?.(2)} :: ${(x.text||x.story?.headline||"").slice(0,100)} :: Q=${x.question?.text ?? x.story?.question ?? "-"}`);
}
async function main(){
  const v:any = await buildTape({ limit: 120, wallet: W } as any);
  dump("VIEWER TAPE (wallet)", v.rows ?? []);
  const s:any = await buildTape({ limit: 120, marketIds: ids } as any);
  dump("SCOPED TAPE (marketIds = held)", s.rows ?? []);
}
main();
