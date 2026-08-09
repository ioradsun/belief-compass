/**
 * check-questions — does the Insider question layer actually fire in production?
 *
 * The unit tests can all pass while the shipped feed asks nothing, because the
 * failure mode is sequencing, not logic. This runs the REAL `buildTape()` over
 * the REAL corpus and reads the pipeline's own question ledger — not a
 * re-derivation, so what it prints is exactly what the reader gets.
 *
 * Reports: surviving stories, single-row candidates, composed-clue candidates,
 * eligibility reason, drafted text, rejections and why, final questions after
 * rationing, questions per 20 stories, repeated shapes, and — the invariant —
 * the number of rationed questions missing from the rendered corpus, which must
 * be zero.
 *
 * Run:  npm run check:questions
 */
process.env["SIGNAL_DIAGNOSTIC"] = "1";

import { buildTape } from "../src/lib/insider/build.server";

type Ledger = {
  id: string;
  kind: string;
  source: "row" | "composed";
  gain: number;
  why: string;
  text: string | null;
  rejected: string | null;
  kept: boolean;
};

async function main() {
  const tape = (await buildTape({ limit: 60 } as never)) as {
    rows: Array<{ id: string; story?: { headline: string; body: string; question?: string | null } | null }>;
    questions?: Ledger[];
  };
  const rows = tape.rows ?? [];
  const ledger = tape.questions ?? [];
  const head = (id: string) => rows.find((r) => r.id === id)?.story?.headline ?? "(gone)";

  console.log(`\nSURVIVING INSIDER STORIES: ${rows.length}`);

  for (const source of ["row", "composed"] as const) {
    const list = ledger.filter((e) => e.source === source);
    console.log(
      `\n${source === "row" ? "SINGLE-ROW" : "COMPOSED-CLUE"} CANDIDATES: ${list.length}\n${"─".repeat(70)}`,
    );
    for (const e of list) {
      console.log(`[${e.kind}] gain=${e.gain.toFixed(2)}  ${head(e.id)}`);
      console.log(`   why  : ${e.why}`);
      console.log(`   draft: ${e.text}`);
      if (e.rejected) console.log(`   REJECTED: ${e.rejected}`);
    }
    if (list.length === 0) console.log("(none)");
  }

  const rendered = rows.filter((r) => (r.story?.question ?? null) != null);
  const kept = ledger.filter((e) => e.kept);
  const shapes = new Map<string, number>();
  for (const e of kept) shapes.set(e.kind, (shapes.get(e.kind) ?? 0) + 1);

  console.log(`\nFINAL QUESTIONS\n${"─".repeat(70)}`);
  for (const r of rendered) console.log(`${r.story?.headline}\n   → ${r.story?.question}`);
  if (rendered.length === 0) console.log("(none)");

  const per20 = rows.length ? (rendered.length / rows.length) * 20 : 0;
  const missing = kept.filter((e) => !rendered.some((r) => r.id === e.id));

  console.log(`\n${"─".repeat(70)}`);
  console.log(`candidates (row)        : ${ledger.filter((e) => e.source === "row").length}`);
  console.log(`candidates (composed)   : ${ledger.filter((e) => e.source === "composed").length}`);
  console.log(`rejected                : ${ledger.filter((e) => e.rejected).length}`);
  console.log(`kept after rationing    : ${kept.length}`);
  console.log(`rendered                : ${rendered.length}`);
  console.log(`per 20 surviving stories: ${per20.toFixed(1)}`);
  console.log(
    `repeated shapes         : ${
      [...shapes].filter(([, n]) => n > 1).map(([k, n]) => `${k}×${n}`).join(", ") || "none"
    }`,
  );
  console.log(`kept but not rendered   : ${missing.length} ${missing.map((m) => m.id).join(", ")}`);

  if (missing.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
