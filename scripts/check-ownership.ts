/**
 * check-ownership — Phase 6.5 static ownership-boundary gate.
 *
 * Fails (exit 1) when it finds a prohibited pattern that would let a superseded
 * path re-enter production. Not perfect static analysis — it covers the known
 * dangerous patterns. Excluded from the production-code total (a diagnostic).
 *
 * Run:  npx tsx scripts/check-ownership.ts   (npm run check:ownership)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src";
type File = { path: string; text: string };

function walk(dir: string): File[] {
  const out: File[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) && name !== "routeTree.gen.ts")
      out.push({ path: p, text: readFileSync(p, "utf8") });
  }
  return out;
}

const files = walk(ROOT);
const violations: string[] = [];
const note = (msg: string) => violations.push(msg);

// Lines that are comments or the known safe mention.
const isCode = (line: string) => !/^\s*\/\//.test(line) && !line.includes("no scoreFeed");

for (const f of files) {
  const lines = f.text.split("\n");
  lines.forEach((line, i) => {
    const at = `${f.path}:${i + 1}`;

    // (1) client/legacy lens scoring must be gone.
    if (/\bscoreFeed\s*\(/.test(line) && isCode(line)) note(`scoreFeed() call — ${at}`);
    if (/from\s+["']@\/lib\/feed-lenses["']/.test(line)) note(`feed-lenses import — ${at}`);

    // (2) retired opportunity types must not appear in the engine.
    if (f.path.endsWith("domain/opportunity.ts") && /["'](tribe|rivals)["']/.test(line))
      note(`retired opportunity type in engine — ${at}`);

    // (3) full-history refold outside repair/reconciliation/pure-core.
    const repairish = /(rebuild-position|reconcile|position-core)/.test(f.path);
    if (
      !repairish &&
      (/\brefold\s*\(/.test(line) || /loadAllCanonicalEvents/.test(line)) &&
      isCode(line)
    )
      note(`full-refold outside repair module — ${at}`);
  });

  // (4) chronological feed_events read in product code (a count/head is fine).
  if (/\.from\(["']feed_events["']\)/.test(f.text) && /\.order\(/.test(f.text)) {
    // Only flag when the same file both selects feed_events AND orders — a
    // chronological read. (getIngestStatus uses head-count only.)
    if (/feed_events[\s\S]{0,200}?\.order\(/.test(f.text))
      note(`chronological feed_events read — ${f.path}`);
  }

  // (5) trades product read = a select of position/chronological columns (a
  //     head-count in getIngestStatus is a diagnostic and allowed).
  if (
    /\.from\(["']trades["']\)/.test(f.text) &&
    /trades["']\)[\s\S]{0,160}?\.select\(["'][^"']*(side|direction|occurred_at|token_amount)/.test(
      f.text,
    ) &&
    !/getIngestStatus/.test(f.text)
  ) {
    note(`trades product read (non-diagnostic) — ${f.path}`);
  }
}

if (violations.length > 0) {
  console.error("[check-ownership] FAILED — prohibited patterns:");
  for (const v of violations) console.error("  ✗ " + v);
  process.exit(1);
}
console.log(
  `[check-ownership] OK — scanned ${files.length} production files, no prohibited patterns.`,
);
