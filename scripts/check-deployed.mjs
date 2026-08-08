/**
 * CAN THE DEPLOYED RUNTIME ACTUALLY DO ITS JOB?
 *
 * Everything else in `scripts/` measures the product. This measures the
 * DEPLOYMENT — the one thing local success can never tell you, because a missing
 * secret is invisible in a repository and fatal in a worker.
 *
 * WHY IT EXISTS. Answering "does the deployed worker have
 * SUPABASE_SERVICE_ROLE_KEY?" once meant probing `/m/<id>` because its SSR
 * loader happens to take a service-role path, then reading a market's believer
 * counts out of an og:description to prove a privileged read had completed. It
 * worked. It is not a procedure anybody should have to rediscover, so it is
 * written down here — including that fallback, because it still works against
 * deployments built before `/api/public/health` existed.
 *
 * IT NEVER ASKS FOR A SECRET'S VALUE and never prints one. With
 * INGEST_RUN_SECRET in the environment it also reads the operator detail from
 * the health endpoint: which variables are missing, BY NAME.
 *
 * Run:  node scripts/check-deployed.mjs [https://conviction.company]
 *       INGEST_RUN_SECRET=… node scripts/check-deployed.mjs   # operator detail
 */
const BASE = (process.argv[2] ?? "https://conviction.company").replace(/\/$/, "");
const SECRET = process.env.INGEST_RUN_SECRET;

const out = [];
const say = (label, verdict, detail = "") =>
  out.push({ label, verdict, detail }) &&
  console.log(
    `${verdict === "PASS" ? "✓" : verdict === "FAIL" ? "✕" : "·"} ${label.padEnd(42)} ${verdict}${detail ? "  " + detail : ""}`,
  );

async function get(path, headers = {}) {
  try {
    const res = await fetch(`${BASE}${path}`, { headers, redirect: "manual" });
    return { status: res.status, text: await res.text() };
  } catch (e) {
    return { status: 0, text: String(e) };
  }
}

console.log(`checking ${BASE}\n`);

// 1 ── Is anything there at all?
const build = await get("/api/public/build-id");
say(
  "deployment answers",
  build.status === 200 ? "PASS" : "FAIL",
  build.status === 200 ? JSON.parse(build.text).buildId : `HTTP ${build.status}`,
);

// 2 ── The purpose-built answer. Absent on older deployments; that is not a fail.
const health = await get("/api/public/health", SECRET ? { authorization: `Bearer ${SECRET}` } : {});
let healthKnown = false;
if (health.status === 404) {
  say("/api/public/health", "SKIP", "not in this build — using the fallback probe");
} else {
  healthKnown = true;
  let body = {};
  try {
    body = JSON.parse(health.text);
  } catch {
    /* non-JSON → treated as a failure below */
  }
  say(
    "service-role health",
    body.ok === true ? "PASS" : "FAIL",
    body.missing?.length
      ? `missing: ${body.missing.join(", ")}`
      : body.serviceRoleRead
        ? `read: ${body.serviceRoleRead}`
        : SECRET
          ? ""
          : "(set INGEST_RUN_SECRET for detail)",
  );
}

/**
 * 3 ── THE FALLBACK PROBE, and the reason it is trustworthy.
 *
 * `/m/<id>` runs `getMarketOg` in its SSR loader. That function opens with
 * `serviceClient()` — no `serviceClientOrNull`, no publishable fallback — and
 * reads `market_state`. So a per-market number in the og:description could only
 * have been produced by a service-role read that completed inside the deployed
 * worker. A missing key throws synchronously and the loader renders the brand
 * fallback instead, which is why the assertion is on the DESCRIPTION rather than
 * on the status code.
 *
 * The market ids come from the sitemap, which uses the PUBLISHABLE client — so
 * the probe never depends on the thing it is testing to find its own input.
 */
const sitemap = await get("/sitemap.xml");
const first = sitemap.text.match(/<loc>[^<]*\/m\/([0-9]+)-[^<]*<\/loc>/);
if (!first) {
  say("service-role read (via /m SSR)", "SKIP", "no market URLs in the sitemap");
} else {
  const page = await get(`/m/${first[1]}`);
  const desc = page.text.match(/property="og:description" content="([^"]*)"/)?.[1] ?? "";
  // The composed description quotes market_state: percentages and believers.
  const real = /\d+% YES/.test(desc);
  say(
    "service-role read (via /m SSR)",
    real ? "PASS" : "FAIL",
    real ? desc.slice(0, 60) : `no market data in og:description — got "${desc.slice(0, 60)}"`,
  );
}

// 4 ── Do OTHER deployment secrets reach the runtime? A job route answers 401
//      when INGEST_RUN_SECRET is set and 500 when it is not, so an unauthorised
//      request is a presence check that needs no credential.
const job = await fetch(`${BASE}/api/public/jobs/match-worker`, { method: "POST" }).catch(
  () => null,
);
say(
  "INGEST_RUN_SECRET reaches the worker",
  job?.status === 401 ? "PASS" : job?.status === 500 ? "FAIL" : "SKIP",
  job ? `HTTP ${job.status}` : "unreachable",
);

const failed = out.filter((o) => o.verdict === "FAIL");
const skipped = out.filter((o) => o.verdict === "SKIP");
console.log(
  `\n${failed.length === 0 ? "VERIFIED — deployed service-role access works" : "NOT VERIFIED"}` +
    (skipped.length ? `  (${skipped.length} skipped)` : ""),
);
if (!healthKnown && failed.length === 0)
  console.log(
    "note: verified through the fallback probe. Deploy this branch to get /api/public/health.",
  );
process.exit(failed.length === 0 ? 0 : 1);
