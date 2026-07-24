/**
 * Service-role Supabase client for job routes. Server-only (`.server.ts`).
 * Ordinary reads should use requireSupabaseAuth or the publishable client;
 * only jobs writing across all wallets/markets need this.
 */
import { createClient } from "@supabase/supabase-js";

export function getServiceSupabase() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) throw new Error("Supabase service env not set");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function assertIngestBearer(req: Request): void {
  const need = process.env.INGEST_RUN_SECRET;
  if (!need) throw new Error("INGEST_RUN_SECRET not configured");
  const got = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (got !== need) {
    throw new Response("Unauthorized", { status: 401 });
  }
}
