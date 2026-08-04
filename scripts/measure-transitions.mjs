/**
 * TRANSITION MEASUREMENT — what does changing markets actually cost?
 *
 * Drives /dev/transitions (the fixture harness) in Chromium across four
 * viewports and reports, per market change:
 *
 *   cls            layout shift attributable to the change (the CLS definition:
 *                  `layout-shift` entries without recent input)
 *   dockMovedPx    how far the decision dock moved during the transition. This
 *                  is the number that matters most — the controls are what the
 *                  hand is aimed at, and they must be in the same place on
 *                  every market whatever its title length or figures.
 *   titleHeights   the distinct heights the question box took. More than one
 *                  value means a long title is pushing the body around.
 *   blankFrames    frames where the centre had no question rendered at all.
 *   remounts       times the deck's root element identity changed — i.e. React
 *                  tore the scene down and rebuilt it instead of updating it.
 *   longTasks      main-thread tasks over 50ms during the transition.
 *
 * Usage:
 *   node scripts/measure-transitions.mjs [label] [baseUrl]
 *
 * Requires a dev server (`npx vite dev --host 127.0.0.1 --port 5199`) and
 * Chromium. Writes a JSON report next to the label and prints a summary table.
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const LABEL = process.argv[2] ?? "run";
const BASE = process.argv[3] ?? process.env.PROBE_BASE ?? "http://127.0.0.1:5199";
const OUT = process.env.PROBE_OUT ?? `transition-report-${LABEL}.json`;

const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  tablet: { width: 900, height: 1200 },
  laptop: { width: 1280, height: 800 },
  desktop: { width: 1680, height: 1050 },
};

/** Injected before any app code so the observers catch everything. */
const INSTRUMENT = `
window.__p = { shifts: [], long: [], frames: [] };
new PerformanceObserver((l) => {
  for (const e of l.getEntries()) {
    if (e.hadRecentInput) continue;
    window.__p.shifts.push({ v: e.value, sources: (e.sources||[]).map(s => {
      const n = s.node;
      const id = n && n.getAttribute ? (n.getAttribute('data-probe') || n.tagName + '.' + String(n.className||'').split(' ').slice(0,2).join('.')) : '?';
      return { node: String(id).slice(0,60),
        dy: s.previousRect && s.currentRect ? Math.round(s.currentRect.y - s.previousRect.y) : null,
        dh: s.previousRect && s.currentRect ? Math.round(s.currentRect.height - s.previousRect.height) : null };
    })});
  }
}).observe({ type: 'layout-shift', buffered: true });
new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__p.long.push(e.duration); })
  .observe({ type: 'longtask', buffered: true });

window.__reset = () => { window.__p.shifts = []; window.__p.long = []; window.__p.frames = []; };

// Sample the anchors that must not move, every frame, for \`ms\`.
window.__watch = (ms) => new Promise((res) => {
  const t0 = performance.now();
  const tick = () => {
    const h1 = document.querySelector('main h1');
    const dock = document.querySelector('[data-probe="dock"]');
    const dr = dock && dock.getBoundingClientRect();
    const hr = h1 && h1.getBoundingClientRect();
    window.__p.frames.push({
      t: Math.round(performance.now() - t0),
      title: h1 ? h1.textContent.trim().slice(0, 40) : null,
      blank: !h1,
      dockY: dr ? Math.round(dr.top) : null,
      dockH: dr ? Math.round(dr.height) : null,
      titleH: hr ? Math.round(hr.height) : null,
      titleY: hr ? Math.round(hr.top) : null,
      dockYFromBottom: dr ? Math.round(innerHeight - dr.top) : null,
    });
    if (performance.now() - t0 < ms) requestAnimationFrame(tick);
    else res(window.__p.frames);
  };
  requestAnimationFrame(tick);
});

// Remount detection: tag the deck root on every sample; a NEW element at the
// same position means React unmounted and rebuilt the subtree.
window.__mountProbe = () => {
  const el = document.querySelector('[data-probe="dock"]');
  if (!el) return null;
  if (!el.__probeId) el.__probeId = Math.random().toString(36).slice(2);
  return el.__probeId;
};
`;

const sum = (a) => a.reduce((s, x) => s + x, 0);
const uniq = (a) => [...new Set(a.filter((v) => v != null))];

async function measureViewport(browser, name, viewport, reducedMotion) {
  const ctx = await browser.newContext({ viewport, reducedMotion });
  await ctx.addInitScript(INSTRUMENT);
  const page = await ctx.newPage();

  let requests = 0;
  page.on("request", () => requests++);

  await page.goto(`${BASE}/dev/transitions`, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForSelector('[data-probe="dock"]', { timeout: 30_000 });
  await page.waitForTimeout(800);

  const count = await page.evaluate(() => window.__scene?.count ?? 0);
  const transitions = [];

  for (let i = 0; i < count; i++) {
    await page.evaluate(() => window.__reset());
    const before = requests;
    const mountBefore = await page.evaluate(() => window.__mountProbe());
    const fromKind = await page.evaluate(() => window.__scene?.kind() ?? "?");

    const t0 = Date.now();
    const watching = page.evaluate(() => window.__watch(700));
    // Driven PROGRAMMATICALLY, not by a click. The layout-shift API sets
    // `hadRecentInput` on every shift within 500ms of a real interaction, and
    // the CLS definition discards those — so a click-driven navigation reports
    // 0.000 no matter how badly the page moves. Calling the same navigation
    // through the scene's own control surface produces the honest number.
    await page.evaluate(() => window.__scene?.next());
    const frames = await watching;
    const wall = Date.now() - t0;

    const mountAfter = await page.evaluate(() => window.__mountProbe());
    const p = await page.evaluate(() => ({ shifts: window.__p.shifts, long: window.__p.long }));

    const dockYs = uniq(frames.map((f) => f.dockY));
    const titleHs = uniq(frames.map((f) => f.titleH));
    transitions.push({
      from: fromKind,
      to: await page.evaluate(() => window.__scene?.kind() ?? "?"),
      wallMs: wall,
      cls: Number(sum(p.shifts.map((s) => s.v)).toFixed(5)),
      shiftSources: p.shifts.flatMap((s) => s.sources).slice(0, 5),
      dockMovedPx: dockYs.length > 1 ? Math.max(...dockYs) - Math.min(...dockYs) : 0,
      titleHeights: titleHs,
      blankFrames: frames.filter((f) => f.blank).length,
      totalFrames: frames.length,
      remounted: mountBefore != null && mountAfter != null && mountBefore !== mountAfter,
      requests: requests - before,
      longTasks: p.long.filter((d) => d > 50).length,
      longestTaskMs: Math.round(Math.max(0, ...p.long)),
    });
    await page.waitForTimeout(400);
  }

  // SKELETON HANDOVER — the loading state must occupy the loaded state's
  // geometry, or every first paint ends with the column rearranging. Measured
  // exactly like a market change: swap skeleton -> deck and watch the anchors.
  const handover = [];
  for (const on of [true, false, true, false]) {
    await page.evaluate(() => window.__reset());
    const watching = page.evaluate(() => window.__watch(500));
    await page.evaluate((v) => window.__scene?.setSkeleton(v), on);
    const frames = await watching;
    const shifts = await page.evaluate(() => window.__p.shifts);
    const dockYs = uniq(frames.map((f) => f.dockY));
    handover.push({
      to: on ? "skeleton" : "deck",
      cls: Number(sum(shifts.map((x) => x.v)).toFixed(5)),
      dockMovedPx: dockYs.length > 1 ? Math.max(...dockYs) - Math.min(...dockYs) : 0,
      dockY: dockYs,
    });
    await page.waitForTimeout(250);
  }

  // Rapid navigation — eight changes as fast as the UI accepts them.
  await page.evaluate(() => window.__reset());
  const rapidWatch = page.evaluate(() => window.__watch(2600));
  for (let i = 0; i < 8; i++) {
    await page.evaluate(() => window.__scene?.next());
    await page.waitForTimeout(90);
  }
  const rapidFrames = await rapidWatch;
  const rapidShifts = await page.evaluate(() => window.__p.shifts);
  const rapidDockYs = uniq(rapidFrames.map((f) => f.dockY));

  const rapid = {
    cls: Number(sum(rapidShifts.map((s) => s.v)).toFixed(5)),
    blankFrames: rapidFrames.filter((f) => f.blank).length,
    totalFrames: rapidFrames.length,
    dockMovedPx: rapidDockYs.length > 1 ? Math.max(...rapidDockYs) - Math.min(...rapidDockYs) : 0,
  };

  await ctx.close();
  return { viewport, transitions, handover, rapid };
}

async function main() {
  const browser = await chromium.launch({
    executablePath:
      process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const report = { label: LABEL, at: new Date().toISOString(), base: BASE, viewports: {} };
  for (const [name, viewport] of Object.entries(VIEWPORTS)) {
    report.viewports[name] = await measureViewport(browser, name, viewport, "no-preference");
  }
  // One pass with reduced motion, to prove the layout guarantees hold without
  // any animation at all.
  report.reducedMotion = await measureViewport(
    browser,
    "desktop-reduced",
    VIEWPORTS.desktop,
    "reduce",
  );
  await browser.close();

  writeFileSync(OUT, JSON.stringify(report, null, 2));

  const line = (name, r) => {
    const t = r.transitions;
    if (!t.length) return `${name.padEnd(16)} no transitions`;
    const avg = (f) => (sum(t.map(f)) / t.length).toFixed(3);
    return (
      `${name.padEnd(16)} n=${String(t.length).padEnd(2)} ` +
      `CLS/txn=${avg((x) => x.cls).padStart(6)} maxCLS=${Math.max(...t.map((x) => x.cls))
        .toFixed(3)
        .padStart(6)} ` +
      `dockMove=${String(Math.max(...t.map((x) => x.dockMovedPx))).padStart(3)}px ` +
      `titleH=${uniq(t.flatMap((x) => x.titleHeights)).join("/")} ` +
      `blank=${sum(t.map((x) => x.blankFrames))} remounts=${t.filter((x) => x.remounted).length} ` +
      `req/txn=${avg((x) => x.requests)} longTasks=${sum(t.map((x) => x.longTasks))} ` +
      `| rapid CLS=${r.rapid.cls} blank=${r.rapid.blankFrames}/${r.rapid.totalFrames} dockMove=${r.rapid.dockMovedPx}px ` +
      `| skeleton<->deck CLS=${Math.max(...(r.handover ?? [{ cls: 0 }]).map((h) => h.cls)).toFixed(4)} dockMove=${Math.max(...(r.handover ?? [{ dockMovedPx: 0 }]).map((h) => h.dockMovedPx))}px`
    );
  };

  console.log(`\n=== transition report: ${LABEL} ===`);
  for (const [name, r] of Object.entries(report.viewports)) console.log(line(name, r));
  console.log(line("reduced-motion", report.reducedMotion));
  console.log(`\nwrote ${OUT}`);
}

main().catch((e) => {
  console.error("measure-transitions failed:", e);
  process.exit(1);
});
