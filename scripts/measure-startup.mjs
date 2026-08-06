/**
 * STARTUP MEASUREMENT — does the app remount itself after it looks ready?
 *
 * The wallet stack boots twice by design: a connector-free wagmi config paints
 * first, then the real connectors arrive on idle. The question this answers is
 * whether that swap costs the tree.
 *
 * HOW THE REMOUNT IS DETECTED, without instrumenting React: capture a reference
 * to an element once the page has painted, then check later whether that exact
 * node is still in the document. React updating in place keeps the node. React
 * unmounting and rebuilding the subtree — which is what a changed `key` on a
 * provider does — detaches it.
 *
 * ANCHOR SHALLOW, NOT DEEP. The first version of this took the DEEPEST node,
 * on the theory that the more of the tree it sat under, the more its survival
 * vouched for. That is exactly backwards on a route that loads data: the
 * deepest node right after paint is usually inside a skeleton, and a skeleton
 * being replaced by real content is the app working, not remounting. It
 * reported a remount on `/` desktop and none on `/` mobile in the same run —
 * an inconsistency that was the probe, not the app.
 *
 * The outermost element the app renders is the correct anchor: it is created
 * once, it does not depend on any query resolving, and it is inside every
 * provider — so it survives all normal rendering and is destroyed only if
 * something above it tears the tree down.
 *
 * Also captured over the same window: layout shift after paint, long tasks, and
 * every request WITH ITS RESPONSE STATUS.
 *
 * The outcome is not decoration. The query client retries three times with
 * backoff, so a server function that FAILS fires four times and is
 * indistinguishable, by URL alone, from four healthy components asking for the
 * same thing. One is an environment artifact and the other is a real ownership
 * bug, and counting URLs cannot tell them apart.
 *
 * HTTP STATUS IS NOT ENOUGH EITHER, and believing it was cost a wrong answer.
 * TanStack Start serialises a thrown server function into a 200 response whose
 * BODY carries the error; the client deserialises, throws, and React Query
 * retries. So a run against a backend the environment cannot reach produces a
 * page full of 200s that are all failures, spaced at exactly retryDelay(0) =
 * 1000ms — which reads as "genuine duplicate observers" to anything that only
 * looks at the status line.
 *
 * Repeats are therefore split by the response BODY: a `$TSR/Error` envelope
 * means the request failed however healthy its status looked.
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
  const status = new Map();
  const times = new Map();
  const t0 = Date.now();
  page.on("request", (r) => {
    requests.push(r.url());
    const list = times.get(r.url()) ?? [];
    list.push(Date.now() - t0);
    times.set(r.url(), list);
  });
  page.on("response", async (r) => {
    const list = status.get(r.url()) ?? [];
    let failed = r.status() >= 400;
    if (!failed && r.url().includes("_serverFn")) {
      // A 200 carrying a serialised throw is a failure. Read only the head —
      // the envelope marker is at the front and payloads can be large.
      try {
        failed = /\$TSR\/Error|"error"/.test((await r.text()).slice(0, 300));
      } catch {
        /* body already consumed or navigation raced it — treat as success */
      }
    }
    list.push(failed ? -1 : r.status());
    status.set(r.url(), list);
  });
  page.on("requestfailed", (r) => {
    const list = status.get(r.url()) ?? [];
    list.push(0); // never answered
    status.set(r.url(), list);
  });

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
    // The app's outermost element: inside every provider, created once, and
    // never waiting on a query. Scripts injected by the framework are skipped.
    const root =
      [...document.body.children].find(
        (el) => el.tagName !== "SCRIPT" && el.tagName !== "STYLE",
      ) ?? null;
    window.__anchor = root;
    window.__anchorAt = Math.round(performance.now());
    return { at: window.__anchorAt, tag: root?.tagName ?? null, id: root?.id || null };
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
    .map(([u, n]) => {
      const codes = status.get(u) ?? [];
      const failed = codes.filter((c) => c === 0 || c === -1 || c >= 400).length;
      return {
        n,
        // WHEN each repeat fired, ms from navigation. Near-simultaneous repeats
        // are separate observers mounting; spread-out ones are refetches. The
        // classification is not decidable from the count alone.
        at: times.get(u) ?? [],
        // A repeat that follows a failure is the retry policy doing its job.
        // A repeat where everything succeeded is two callers asking twice.
        kind: failed > 0 ? "retry-after-failure" : "duplicate-success",
        codes,
        url: u.replace(BASE, ""),
      };
    })
    .sort((a, b) => b.n - a.n);

  await context.close();
  return {
    viewport: name,
    anchor: anchored,
    // True when any server function answered with a serialised throw. When it
    // is, every repeat count below is retry noise and the run cannot be used to
    // audit request ownership.
    serverFnsFailing: [...status.values()].flat().some((c) => c === -1),
    treeRemounted: after.stillAttached === false,
    clsAfterPaint: after.cls,
    shifts: after.shifts,
    longTasks: after.longTasks,
    requestsTotal: requests.length,
    requestsAfterPaint: requests.length - requestsAtAnchor,
    duplicates: duplicates.slice(0, 8),
  };
}

/** Server-function URLs are base64 blobs; print the export name instead. */
function label(url) {
  const m = url.match(/^\/_serverFn\/([A-Za-z0-9_-]+)/);
  if (!m) return url.length > 60 ? `${url.slice(0, 60)}…` : url;
  try {
    const json = JSON.parse(Buffer.from(m[1].replace(/-/g, "+").replace(/_/g, "/"), "base64"));
    return String(json.export).replace("_createServerFn_handler", "");
  } catch {
    return url.slice(0, 40);
  }
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
      `  requests=${r.requestsTotal} (${r.requestsAfterPaint} after paint)`,
  );
  const real = r.duplicates.filter((d) => d.kind === "duplicate-success");
  const retried = r.duplicates.filter((d) => d.kind === "retry-after-failure");
  console.log(
    `           repeats: ${real.length} genuine, ${retried.length} retry-after-failure`,
  );
  for (const d of real)
    console.log(`           ×${d.n} GENUINE  ${label(d.url)}  at ${d.at.join("ms, ")}ms`);
  for (const d of retried)
    console.log(`           ×${d.n} retry    ${label(d.url)}  at ${d.at.join("ms, ")}ms`);
  if (r.serverFnsFailing)
    console.log(
      "           NOTE: server functions are failing here (200 with an error body).\n" +
        "                 Request-ownership numbers from this run are retry noise, not evidence.",
    );
}
console.log(`\nwrote ${file}\n`);
