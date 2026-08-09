/**
 * check-composition — did sequences of ordinary events become ONE observation?
 *
 * Prints, over the real corpus:
 *   BEFORE : every row a promoted person-pattern absorbed (the constituent
 *            receipts the global feed used to print alongside the aside)
 *   AFTER  : the surviving person rows, grouped by person
 *   and the unanswered-market motif count, before and after rationing.
 *
 * Run:  npm run check:composition
 */
process.env["SIGNAL_DIAGNOSTIC"] = "1";

import { buildTape } from "../src/lib/live.functions";

type Row = {
  id: string;
  kind: string;
  wallet?: string | null;
  face?: { name?: string | null } | null;
  marketTitle?: string | null;
  story?: { headline: string; body: string; pattern?: string | null; question?: string | null } | null;
};

async function main() {
  const tape = (await buildTape({ limit: 60 } as never)) as {
    rows: Row[];
    composition?: { consumed: Array<{ id: string; headline: string }> };
  };
  const rows = tape.rows ?? [];
  const consumed = tape.composition?.consumed ?? [];

  console.log(`\nREPEATED-PERSON EVENTS\n${"─".repeat(70)}`);
  console.log(`BEFORE — receipts absorbed into a behavioural story: ${consumed.length}`);
  for (const c of consumed) console.log(`  - ${c.headline}   (${c.id})`);

  const byPerson = new Map<string, Row[]>();
  for (const r of rows) {
    const w = r.wallet?.toLowerCase();
    if (!w) continue;
    (byPerson.get(w) ?? byPerson.set(w, []).get(w)!).push(r);
  }
  console.log(`\nAFTER — surviving rows per person`);
  for (const [w, list] of [...byPerson].sort((a, b) => b[1].length - a[1].length)) {
    const name = list.find((r) => r.face?.name)?.face?.name ?? w.slice(0, 10);
    console.log(`  ${name}: ${list.length}`);
    for (const r of list)
      console.log(
        `     ${r.story?.headline} / ${r.story?.body}${r.story?.pattern ? `  [aside: ${r.story.pattern}]` : ""}${r.story?.question ? `  [Q: ${r.story.question}]` : ""}`,
      );
  }

  console.log(`\nUNANSWERED MARKETS\n${"─".repeat(70)}`);
  const waiting = rows.filter((r) => (r.story?.headline ?? "").startsWith("STILL WAITING"));
  console.log(`AFTER — "STILL WAITING FOR A SIDE" rows in the global feed: ${waiting.length}`);
  for (const r of waiting) console.log(`  - ${r.story?.body}`);
  const created = rows.filter((r) => r.kind === "market_created");
  console.log(`market_created rows total: ${created.length}`);
  for (const r of created) console.log(`  - ${r.story?.headline} / ${r.story?.body}`);
  console.log(`\nTOTAL ROWS: ${rows.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
