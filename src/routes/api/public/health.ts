/**
 * `/api/public/health` — CAN THIS DEPLOYMENT DO ITS JOB?
 *
 * WHY THIS EXISTS. Verifying that the deployed worker actually had
 * SUPABASE_SERVICE_ROLE_KEY once took an afternoon of archaeology: probing
 * `/m/<id>` because its SSR loader happens to take a service-role path, and
 * reading a market's believer counts out of an og:description to prove a
 * privileged read had succeeded. That worked, and it is a ridiculous way to
 * answer a yes/no question about deployment configuration.
 *
 * The failure it answers is the one worth catching, because it is INVISIBLE.
 * `createClient` throws synchronously without a key, so a worker missing that
 * one variable turns every privileged read into an exception — and this
 * codebase's habit of destructuring `{ data }` without `error` turns those
 * exceptions into `[]`. The social graph does not go down. It goes QUIET: no
 * Challenges, no relationships, no callers, and a UI that looks calm and says
 * nothing is wrong.
 *
 * WHAT IT REPORTS, AND WHAT IT REFUSES TO.
 *
 *   public          `{ ok }` and nothing else. Enough for a monitor to page on,
 *                   useless to anybody else.
 *   with the bearer which secrets are missing BY NAME, and whether a real
 *                   service-role read completed.
 *
 * It never returns a secret's VALUE, never echoes a database error string (which
 * can carry connection detail), and never accepts a parameter. The check is a
 * `HEAD`-shaped read of a table that always exists — one row, no columns — so it
 * costs nothing and proves the credential works rather than merely being present.
 *
 * A PRESENT KEY IS NOT A WORKING KEY. That is why `read` exists separately from
 * `secrets`: a rotated-but-stale service key passes every presence check and
 * fails every query, which would look exactly like the outage this endpoint is
 * meant to make visible.
 */
import { createFileRoute } from "@tanstack/react-router";
import { missingServiceSecrets, serviceClient } from "@/lib/supabase-clients";

type ReadStatus = "ok" | "failed" | "skipped";

/** Did a privileged read actually complete? Not "is the key set" — did it work. */
async function serviceRoleRead(): Promise<ReadStatus> {
  if (missingServiceSecrets().length > 0) return "skipped";
  try {
    const sb = serviceClient();
    // `head: true` asks for the count and no rows: the cheapest query that still
    // proves RLS was bypassed with a credential the database accepted.
    const { error } = await sb
      .from("markets")
      .select("onchain_id", { count: "exact", head: true })
      .limit(1);
    return error ? "failed" : "ok";
  } catch {
    // Deliberately not surfaced to the caller — the STATUS is the answer, and a
    // driver message can carry connection detail that has no business here.
    return "failed";
  }
}

export const Route = createFileRoute("/api/public/health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const missing = missingServiceSecrets();
        const read = await serviceRoleRead();
        const ok = missing.length === 0 && read === "ok";

        // The bearer the job routes already use. Same secret, same operator.
        const need = process.env.INGEST_RUN_SECRET;
        const got = request.headers
          .get("authorization")
          ?.replace(/^Bearer\s+/i, "")
          .trim();
        const operator = !!need && got === need;

        return new Response(
          JSON.stringify(operator ? { ok, missing, serviceRoleRead: read } : { ok }),
          {
            // 503 so a monitor that only reads status codes still pages. A
            // degraded deployment must never answer 200.
            status: ok ? 200 : 503,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store, must-revalidate",
            },
          },
        );
      },
    },
  },
});
