/**
 * with-pg — bring up a throwaway Postgres, run the transactional suite, tear it down.
 *
 * `put-on-table.pg.test.ts` and `simulation.pg.test.ts` prove the claims in this
 * codebase that a mock cannot: that a failed Challenge leaves NOTHING behind,
 * that a duplicate Simulation order replays rather than spending CC twice, and
 * that the real and Simulation call ledgers cannot consume each other. They skip
 * themselves without a cluster, which is right for CI and wrong as a habit — a
 * suite that quietly skips reads as a suite that passed. This makes running them
 * one command.
 *
 *   npm run test:pg
 *
 * The cluster is trust-auth, loopback-only, on a non-default port, in a
 * directory it deletes on the way out. Nothing here is intended to survive the
 * process, and nothing here should ever point at a real database — the suites
 * TRUNCATE every table they touch.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";

const PORT = process.env.PG_TEST_PORT ?? "5433";
const DATA = process.env.PG_TEST_DATA ?? "/var/tmp/pgdata-conviction";
const URL = `postgres://postgres@localhost:${PORT}/postgres`;

/** The server binaries are not on PATH on Debian/Ubuntu — they live per-major. */
function binDir(): string {
  const roots = ["/usr/lib/postgresql", "/usr/local/pgsql"];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    if (existsSync(`${root}/bin/initdb`)) return `${root}/bin`;
    const majors = execFileSync("ls", [root], { encoding: "utf8" })
      .split("\n")
      .filter(Boolean)
      .sort((a, b) => Number(b) - Number(a));
    for (const m of majors) if (existsSync(`${root}/${m}/bin/initdb`)) return `${root}/${m}/bin`;
  }
  throw new Error(
    "No Postgres server binaries found. Install postgresql (not just the client),\n" +
      "or point the suite at your own cluster:\n" +
      "  PGURL='postgres://…' npx vitest run put-on-table.pg",
  );
}

/**
 * initdb REFUSES TO RUN AS ROOT, and containers commonly are. Dropping to the
 * `postgres` account is the supported way; where that account does not exist we
 * are not root either, so running directly is fine.
 */
const asPostgres = process.getuid?.() === 0;
const run = (cmd: string, args: string[]) =>
  asPostgres
    ? spawnSync("su", ["postgres", "-c", [cmd, ...args].join(" ")], { stdio: "inherit" })
    : spawnSync(cmd, args, { stdio: "inherit" });

const bin = binDir();

function stop() {
  run(`${bin}/pg_ctl`, ["-D", DATA, "-m", "immediate", "stop"]);
}

try {
  rmSync(DATA, { recursive: true, force: true });
  mkdirSync(DATA, { recursive: true });
  if (asPostgres) {
    execFileSync("chown", ["postgres:postgres", DATA]);
    execFileSync("chmod", ["700", DATA]);
  }

  run(`${bin}/initdb`, ["-D", DATA, "-U", "postgres", "--auth=trust"]);
  run(`${bin}/pg_ctl`, ["-D", DATA, "-o", `'-p ${PORT} -k /tmp'`, "-l", `${DATA}/log`, "start"]);

  const test = spawnSync(
    "npx",
    [
      "vitest",
      "run",
      "src/lib/put-on-table.pg.test.ts",
      // The Simulation ledger's claims are transactional too — idempotency under
      // a race, a refused order leaving nothing, the two call ledgers not
      // consuming each other. None of them can be proved without a cluster.
      "src/lib/simulation.pg.test.ts",
      // ONE CLUSTER, ONE SUITE AT A TIME. Both suites own the same two Challenge
      // tables and each drops and recreates them in its own setup; run in
      // parallel they tear the ground out from under each other.
      "--no-file-parallelism",
      "--reporter=verbose",
    ],
    { stdio: "inherit", env: { ...process.env, PGURL: URL } },
  );
  stop();
  rmSync(DATA, { recursive: true, force: true });
  process.exit(test.status ?? 1);
} catch (e) {
  stop();
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
