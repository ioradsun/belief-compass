/**
 * check-questions — does the PI question layer actually fire in production?
 *
 * The unit tests can all pass while the shipped feed asks nothing, because the
 * failure mode is sequencing, not logic. This runs the REAL `buildTape()` over
 * the REAL corpus with signal diagnostics on, and reports, for the rows the
 * reader would actually see:
 *
 *   surviving rows
 *   rows eligible for a question before rationing, and why each qualified
 *   questions drafted
 *   questions rejected because they only echoed the row (questionAdds)
 *   final questions after rationing
 *   whether any rationed row is missing from the rendered feed (must be 0)
 *   every person-pattern row, and whether it qualified
 *
 * Run:  npx tsx scripts/check-questions.ts
 * Env:  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
process.env["SIGNAL_DIAGNOSTIC"] = "1";

import { buildTape } from "../src/lib/live.functions";
import { piQuestion, questionAdds, rationQuestions, type QuestionKind } from "../src/domain/pi-question";
import { voiceLevel, INTELLIGENCE_GAIN_MIN, type VoiceInput } from "../src/domain/pi-voice";

const UNWINDING = /backing away|unwinding|cutting|reducing|stepped back|trimming/i;

function why(v: VoiceInput | null | undefined, pattern: string | null): string | null {
  if (!v) return null;
  const level = voiceLevel(v);
  const reasons: string[] = [];
  if (level === "intelligence") reasons.push(`intelligence(gain=${v.informationGain.toFixed(2)})`);
  if (pattern && UNWINDING.test(pattern)) reasons.push("proven unwinding pattern");
  if (v.signals.concentration >= 0.6 && v.informationGain >= INTELLIGENCE_GAIN_MIN)
    reasons.push(`concentration=${v.signals.concentration.toFixed(2)}`);
  if (v.signals.beforePrice >= 0.6 && v.informationGain >= INTELLIGENCE_GAIN_MIN)
    reasons.push(`beforePrice=${v.signals.beforePrice.toFixed(2)}`);
  if (v.clue === "resolved") return null;
  return reasons.length ? reasons.join(" + ") : null;
}

async function main() {
  const tape = await buildTape({ limit: 60 } as never);
  const rows = ((tape as { events?: unknown[] }).events ?? []) as Array<{
    id: string;
    kind: string;
    marketTitle?: string | null;
    story?: { headline: string; body: string; pattern?: string | null; question?: string | null } | null;
    signal?: VoiceInput | null;
    face?: { name?: string | null } | null;
  }>;

  console.log(`\nSURVIVING ROWS: ${rows.length}\n${"─".repeat(70)}`);

  const eligible: Array<{ id: string; kind: QuestionKind; gain: number }> = [];
  const drafted = new Map<string, string>();
  let echoRejected = 0;

  for (const r of rows) {
    const pattern = r.story?.pattern ?? null;
    const reason = why(r.signal, pattern);
    if (!reason) continue;
    console.log(`\nELIGIBLE  ${r.id}  [${r.kind}]  ${reason}`);
    console.log(`  ${r.story?.headline ?? "—"} / ${r.story?.body ?? "—"}`);
    const q = piQuestion({
      key: r.id,
      signal: r.signal,
      headline: r.story?.headline ?? "",
      body: r.story?.body ?? "",
      pattern,
      actorName: r.face?.name ?? null,
    });
    if (!q) {
      const echo = "would echo the row (questionAdds) or no shape matched";
      echoRejected++;
      console.log(`  DRAFT: none — ${echo}`);
      continue;
    }
    drafted.set(r.id, q.text);
    eligible.push({ id: r.id, kind: q.kind, gain: r.signal?.informationGain ?? 0 });
    console.log(`  DRAFT [${q.kind}]: ${q.text}`);
  }

  const keep = rationQuestions(eligible);
  const rendered = rows.filter((r) => (r.story?.question ?? null) != null);

  console.log(`\n${"─".repeat(70)}`);
  console.log(`eligible before rationing : ${eligible.length + echoRejected}`);
  console.log(`drafted                   : ${drafted.size}`);
  console.log(`rejected (echo / no shape): ${echoRejected}`);
  console.log(`kept after rationing      : ${keep.size}`);
  console.log(`rendered with a question  : ${rendered.length}`);

  const missing = [...keep].filter((id) => !rows.some((r) => r.id === id));
  console.log(`rationed but not rendered : ${missing.length} ${missing.join(", ")}`);

  console.log(`\nPERSON-PATTERN ROWS\n${"─".repeat(70)}`);
  const patterned = rows.filter((r) => (r.story?.pattern ?? null) != null);
  if (patterned.length === 0) console.log("(none in this window)");
  for (const r of patterned) {
    console.log(
      `${r.id}  qualified=${drafted.has(r.id)}  unwinding=${UNWINDING.test(r.story!.pattern!)}\n  ${r.story!.pattern}`,
    );
  }

  console.log(`\nRENDERED QUESTIONS\n${"─".repeat(70)}`);
  for (const r of rendered) console.log(`${r.story?.headline}\n  → ${r.story?.question}`);
  if (rendered.length === 0) console.log("(none)");

  if (missing.length > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
