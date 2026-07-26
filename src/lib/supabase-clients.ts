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

export function serviceClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
