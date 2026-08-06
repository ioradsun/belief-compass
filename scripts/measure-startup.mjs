/**
 * STARTUP MEASUREMENT — does the app remount itself after it looks ready?
 *
 * The wallet stack boots twice by design: a connector-free wagmi config paints
 * first, then the real connectors arrive on idle. The question this answers is
 * whether that swap costs the tree.
 *
 * HOW THE REMOUNT IS DETECTED, without instrumenting React: capture a reference
 * to a deep element once the page has painted, then check later whether that
 * exact node is still in the document. React updating in place keeps the node.
 * React unmounting and rebuilding the subtree — which is what a changed `key`
 * on a provider does — detaches it. There is no ambiguity in the signal and
 * nothing in the app has to cooperate.
 *
 * Also captured over the same window: layout shift after paint, long tasks, and
 * the request count (so a duplicate startup fetch shows up as a number rather
 * than an argument).
 *
 * Any route works — every one of them mounts the root providers — so this drives
 * the fixture route and needs no database.
 *
 *   npx vite dev --host 127.0.0.1 --port 5199
 *   node scripts/measure-startup.mjs [label] [baseUrl]
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const LABEL = process.argv[2] ?? "run";
const BASE = process.argv[3] ?? process.env.PROBE_BASE ?? "http://127.0.0.1:5199";
const PATH = process.env.PROBE_PATH ?? "/dev/transitions";
/** Past the idle wallet boot (requestIdleCallback, or a 200ms fallback). */
const WATCH_MS = Number(process.env.PROBE_WATCH_MS ?? 4000);

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

async function measure(browser, name, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  const requests = [];
  page.on("request", (r) => requests.push(r.url()));

  await page.addInitScript(() => {
    const w = window;
    w.__probe = { cls: 0, longTasks: 0, shifts: [] };
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (!e.hadRecentInput) {
            w.__probe.cls += e.value;
            w.__probe.shifts.push({ t: Math.round(e.startTime), v: Number(e.value.toFixed(4)) });
          }
        }
      }).observe({ type: "layout-shift", buffered: true });
      new PerformanceObserver((list) => {
        w.__probe.longTasks += list.getEntries().length;
      }).observe({ type: "longtask", buffered: true });
    } catch {
      /* older Chromium — the counts stay zero rather than failing the run */
    }
  });

  await page.goto(`${BASE}${PATH}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  // Wait for real content, not just a shell: a node deep enough that its
  // survival says something about the tree rather than about the <body>.
  await page.waitForSelector("body *", { timeout: 30_000 });
  await page.waitForTimeout(300);

  const anchored = await page.evaluate(() => {
    const all = document.querySelectorAll("body *");
    // The deepest early node available — the further from <body>, the more of
    // the tree its survival vouches for.
    let deepest = null;
    let best = -1;
    for (const el of all) {
      let d = 0;
      for (let p = el; p; p = p.parentElement) d += 1;
      if (d > best) {
        best = d;
        deepest = el;
      }
    }
    window.__anchor = deepest;
    window.__anchorDepth = best;
    window.__anchorAt = Math.round(performance.now());
    return { depth: best, at: window.__anchorAt, tag: deepest?.tagName ?? null };
  });

  const requestsAtAnchor = requests.length;
  await page.waitForTimeout(WATCH_MS);

  const after = await page.evaluate(() => ({
    stillAttached: window.__anchor ? document.contains(window.__anchor) : null,
    cls: Number(window.__probe.cls.toFixed(4)),
    shifts: window.__probe.shifts,
    longTasks: window.__probe.longTasks,
  }));

  // A request fetched more than once in one startup is a duplicate by
  // definition — the same bytes over the wire twice.
  const counts = new Map();
  for (const u of requests) counts.set(u, (counts.get(u) ?? 0) + 1);
  const duplicates = [...counts.entries()]
    .filter(([, n]) => n > 1)
    .map(([u, n]) => ({ n, url: u.replace(BASE, "") }))
    .sort((a, b) => b.n - a.n);

  await context.close();
  return {
    viewport: name,
    anchorDepth: anchored.depth,
    treeRemounted: after.stillAttached === false,
    clsAfterPaint: after.cls,
    shifts: after.shifts,
    longTasks: after.longTasks,
    requestsTotal: requests.length,
    requestsAfterPaint: requests.length - requestsAtAnchor,
    duplicates: duplicates.slice(0, 8),
  };
}

const browser = await chromium.launch();
const report = { label: LABEL, at: new Date().toISOString(), base: BASE, path: PATH, runs: [] };
for (const [name, viewport] of Object.entries(VIEWPORTS)) {
  report.runs.push(await measure(browser, name, viewport));
}
await browser.close();

const file = `startup-${LABEL}.json`;
writeFileSync(file, JSON.stringify(report, null, 2));

console.log(`\nSTARTUP — ${LABEL}  (${PATH}, watched ${WATCH_MS}ms after paint)\n`);
for (const r of report.runs) {
  console.log(
    `  ${r.viewport.padEnd(8)} tree remounted after paint: ${r.treeRemounted ? "YES  ✗" : "no   ✓"}` +
      `   cls=${r.clsAfterPaint}  longTasks=${r.longTasks}` +
      `  requests=${r.requestsTotal} (${r.requestsAfterPaint} after paint)` +
      `  duplicates=${r.duplicates.length}`,
  );
  for (const d of r.duplicates) console.log(`           ×${d.n}  ${d.url}`);
}
console.log(`\nwrote ${file}\n`);
