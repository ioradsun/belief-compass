/**
 * Service-role Supabase client for job routes. Server-only (`.server.ts`).
 * Ordinary reads should use requireSupabaseAuth or the publishable client;
 * only jobs writing across all wallets/markets need this.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { SupabaseClient } from "@supabase/supabase-js";

export function getServiceSupabase(): SupabaseClient {
  return supabaseAdmin as unknown as SupabaseClient;
}

export function assertIngestBearer(req: Request): void {
  const need = process.env.INGEST_RUN_SECRET;
  if (!need) throw new Error("INGEST_RUN_SECRET not configured");
  const got = req.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  if (got !== need) {
    throw new Response("Unauthorized", { status: 401 });
  }
}
