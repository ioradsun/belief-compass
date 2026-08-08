/**
 * Supabase client factories — one place, so every server function talks to the
 * database the same way.
 *
 * `publicClient()` uses the publishable key and reads only public tables (RLS
 * enforced). The `sb_`-prefixed publishable key must NOT be sent as a Bearer
 * Authorization header — Supabase rejects it there — so the fetch shim strips it
 * and passes the key as `apikey` instead. `serviceClient()` uses the service-role
 * key for privileged writes (cache upserts, etc.) and bypasses RLS.
 */
import { createClient } from "@supabase/supabase-js";

export function publicClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`)
          h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

/**
 * The secrets a service-role path cannot run without. Names only — this module
 * never reads a VALUE into anything that could be returned or logged.
 */
export const SERVICE_ROLE_SECRETS = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"] as const;

/** Which of them the runtime is missing. Empty means the runtime is equipped. */
export function missingServiceSecrets(): string[] {
  return SERVICE_ROLE_SECRETS.filter((k) => !process.env[k]);
}

/**
 * SAY IT OUT LOUD. `createClient` throws "supabaseKey is required" — a message
 * from a library, about an argument, naming nothing an operator can act on. It
 * surfaced as a 500 with no clue which deployment variable was absent, on a path
 * whose product-visible symptom is an empty room.
 *
 * So the failure is named here instead, once, in the operator's vocabulary. The
 * string is stable and greppable on purpose: it is what you search the worker
 * logs for, and what `/api/public/health` reports as a missing name.
 */
export function serviceClient() {
  const missing = missingServiceSecrets();
  if (missing.length > 0) {
    const message = `service-role unavailable: missing ${missing.join(", ")}`;
    // A throw alone can be swallowed by a caller; the log cannot. Both, always —
    // the whole point is that this never becomes a quiet empty state.
    console.error(`[env] ${message}`);
    throw new Error(message);
  }
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * The same client, but null instead of an exception when the service key is
 * absent. For READ paths that merely lose detail without it.
 *
 * `createClient` throws "supabaseKey is required" synchronously on a missing
 * key, so calling `serviceClient()` on a public request path couples that whole
 * path to a secret. The live tape does exactly one privileged read — how long
 * each actor had held the belief they just changed — and it is enrichment: the
 * grammar already degrades to the plain sentence without it. Before this, a
 * rotated or unset key turned "the feed loses tenure" into "the feed 500s for
 * everyone", which is not a trade anyone would choose.
 *
 * Use this wherever the answer to "what if the key is missing?" is "show less",
 * and `serviceClient()` where it is "this job cannot run".
 */
export function serviceClientOrNull() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? serviceClient() : null;
}
