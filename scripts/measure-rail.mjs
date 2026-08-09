/**
 * RAIL STABILITY — how far does the right column move when it changes?
 *
 * Drives /dev/rail in Chromium and reports, per interaction:
 *
 *   cls        layout shift attributable to the change (`layout-shift` entries
 *              without recent input — the CLS definition)
 *   nowMovedPx how far the "Now" heading moved. This is the number that matters:
 *              everything above it is optional chrome and everything below it is
 *              the live tape, so if the heading holds, the tape holds.
 *   tapeHs     the distinct heights the tape's viewport took. More than one
 *              value means a block above it resized the reader's window onto the
 *              feed — the rows they were reading are now somewhere else.
 *   settleMs   how long the movement took. 0 is a JUMP (a discontinuity between
 *              two frames); a couple hundred ms is a movement the eye follows.
 *              These are different things and the fix is not to make the number
 *              smaller, it is to make it non-zero and bounded.
 *
 * Each case runs twice — once against the current build, once with the fixture
 * in `legacy` mode (instant mount/unmount, unreserved text) — so the report is a
 * before/after rather than an assertion.
 *
 * Usage:
 *   npx vite dev --host 127.0.0.1 --port 5199
 *   node scripts/measure-rail.mjs [label] [baseUrl]
 */
import { chromium } from "playwright";

const LABEL = process.argv[2] ?? "run";
const BASE = process.argv[3] ?? process.env.PROBE_BASE ?? "http://127.0.0.1:5199";

const INSTRUMENT = `
window.__p = { shifts: [] };
new PerformanceObserver((l) => {
  for (const e of l.getEntries()) {
    if (e.hadRecentInput) continue;
    window.__p.shifts.push({ v: e.value });
  }
}).observe({ type: 'layout-shift', buffered: true });
window.__reset = () => { window.__p.shifts = []; };

// Sample the anchors that must not move, every frame, for \`ms\`.
window.__watch = (ms) => new Promise((res) => {
  const t0 = performance.now();
  const frames = [];
  const tick = () => {
    const now = document.querySelector('[data-probe="now"]');
    const tape = document.querySelector('[data-probe="tape"]');
    const row = tape && tape.querySelector('div:last-of-type');
    const nr = now && now.getBoundingClientRect();
    const tr = tape && tape.getBoundingClientRect();
    frames.push({
      t: Math.round(performance.now() - t0),
      nowY: nr ? Math.round(nr.top) : null,
      tapeH: tr ? Math.round(tr.height) : null,
      rowY: row ? Math.round(row.getBoundingClientRect().top) : null,
    });
    if (performance.now() - t0 < ms) requestAnimationFrame(tick);
    else res(frames);
  };
  requestAnimationFrame(tick);
});
`;

const sum = (a) => a.reduce((s, x) => s + x, 0);
const uniq = (a) => [...new Set(a.filter((v) => v != null))];

/** When did the anchor stop moving? 0 means it teleported in one frame. */
function settleMs(frames, key) {
  let last = null;
  let lastChangeT = 0;
  let changes = 0;
  for (const f of frames) {
    if (last != null && f[key] !== last) {
      lastChangeT = f.t;
      changes++;
    }
    last = f[key];
  }
  return { settleMs: lastChangeT, steps: changes };
}

/**
 * Every case sets the FULL precondition, not just the one flag it changes.
 *
 * An earlier version set only its own flag and inherited the rest from whatever
 * the previous case left behind — so "expand" ran against a collapsed card and
 * reported a flawless 0px, because expanding something with zero height moves
 * nothing. A harness that can report success for an interaction that did not
 * happen is worse than no harness.
 */
const ALL_OFF = {
  topCard: false,
  activity: false,
  expanded: false,
  longBeat: false,
  pending: false,
};
const setAll = (p, s) =>
  p.evaluate(
    (v) => {
      window.__rail.setTopCard(v.topCard);
      window.__rail.setActivity(v.activity);
      window.__rail.setExpanded(v.expanded);
      window.__rail.setLongBeat(v.longBeat);
    },
    { ...ALL_OFF, ...s },
  );

const CASES = [
  {
    name: "activity card appears (market gains its first event)",
    setup: (p) => setAll(p, { topCard: true }),
    act: (p) => p.evaluate(() => window.__rail.setActivity(true)),
  },
  {
    name: "activity card disappears (switch to a quiet market)",
    setup: (p) => setAll(p, { topCard: true, activity: true }),
    act: (p) => p.evaluate(() => window.__rail.setActivity(false)),
  },
  {
    name: "latest beat rewraps to two lines (an event lands)",
    setup: (p) => setAll(p, { topCard: true, activity: true }),
    act: (p) => p.evaluate(() => window.__rail.setLongBeat(true)),
  },
  {
    name: "top card disappears (its data runs out)",
    setup: (p) => setAll(p, { topCard: true, activity: true }),
    act: (p) => p.evaluate(() => window.__rail.setTopCard(false)),
  },
  {
    name: "update control appears (activity arrives)",
    setup: (p) => setAll(p, { topCard: true, activity: true }),
    act: (p) => p.evaluate(() => window.__rail.setPending(true)),
    anchor: "rowY",
  },
  {
    name: "update control is tapped (it goes away)",
    setup: (p) => setAll(p, { topCard: true, activity: true, pending: true }),
    act: (p) => p.evaluate(() => window.__rail.setPending(false)),
    anchor: "rowY",
  },
  {
    name: "expand 'Market Insider'",
    setup: (p) => setAll(p, { topCard: true, activity: true }),
    act: (p) => p.evaluate(() => window.__rail.setExpanded(true)),
  },
];

async function runMode(page, legacy) {
  await page.evaluate((v) => window.__rail.setLegacy(v), legacy);
  await page.waitForTimeout(250);
  const out = [];
  for (const c of CASES) {
    // The expand case does not exist in legacy mode — it opened a fixed overlay
    // over the whole column rather than changing the column's own layout.
    if (legacy && c.name.startsWith("expand")) {
      out.push({ name: c.name, skipped: "was a full-column overlay, not a layout change" });
      continue;
    }
    await c.setup(page);
    await page.waitForTimeout(320);
    await page.evaluate(() => window.__reset());
    const watching = page.evaluate(() => window.__watch(650));
    await c.act(page);
    const frames = await watching;
    const shifts = await page.evaluate(() => window.__p.shifts);
    const anchorKey = c.anchor ?? "nowY";
    const nowYs = uniq(frames.map((f) => f[anchorKey]));
    const tapeHs = uniq(frames.map((f) => f.tapeH));
    out.push({
      name: c.name,
      cls: Number(sum(shifts.map((s) => s.v)).toFixed(5)),
      nowMovedPx: nowYs.length > 1 ? Math.max(...nowYs) - Math.min(...nowYs) : 0,
      tapeHeights: tapeHs.length,
      ...settleMs(frames, c.anchor ?? "nowY"),
    });
    await page.waitForTimeout(250);
  }
  return out;
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(INSTRUMENT);
const page = await ctx.newPage();
await page.goto(`${BASE}/dev/rail`, { waitUntil: "networkidle", timeout: 60_000 });
await page.waitForSelector('[data-probe="now"]', { timeout: 30_000 });
await page.waitForTimeout(500);

const before = await runMode(page, true);
const after = await runMode(page, false);

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n═══ RIGHT RAIL — ${LABEL} ═══\n`);
console.log(
  `  ${pad("interaction", 48)} ${pad("mode", 7)} ${pad("cls", 9)} ${pad("nowMoved", 9)} ${pad("tapeHs", 7)} settle`,
);
for (let i = 0; i < after.length; i++) {
  for (const [mode, row] of [
    ["before", before[i]],
    ["after", after[i]],
  ]) {
    if (row.skipped) {
      console.log(`  ${pad(row.name.slice(0, 46), 48)} ${pad(mode, 7)} — ${row.skipped}`);
      continue;
    }
    console.log(
      `  ${pad(row.name.slice(0, 46), 48)} ${pad(mode, 7)} ${pad(row.cls, 9)} ${pad(row.nowMovedPx + "px", 9)} ${pad(row.tapeHeights, 7)} ${row.settleMs}ms/${row.steps} steps`,
    );
  }
  console.log("");
}

await browser.close();
