/**
 * Moderation console — server side.
 *
 * A shared password gate, not authentication: one secret, one operator, no
 * per-user identity. The password is compared timing-safely on the server and
 * the unlocked flag lives in an encrypted, http-only session cookie.
 *
 * The session machinery itself lives in `admin-session.server.ts` and is loaded
 * inside handlers, so nothing server-only reaches a client bundle.
 */
import { createServerFn } from "@tanstack/react-start";

export const adminLogin = createServerFn({ method: "POST" })
  .inputValidator((data: { password: string }) => data)
  .handler(async ({ data }) => {
    const expected = process.env.ADMIN_PASSWORD;
    if (!expected) throw new Error("Moderation isn't configured.");
    const { adminSession, passwordMatches } = await import("./admin-session.server");
    if (!(await passwordMatches(String(data.password ?? ""), expected))) {
      return { ok: false as const };
    }
    const session = await adminSession();
    await session.update({ unlocked: true });
    return { ok: true as const };
  });

export const adminLogout = createServerFn({ method: "POST" }).handler(async () => {
  const { adminSession } = await import("./admin-session.server");
  const session = await adminSession();
  await session.clear();
  return { ok: true as const };
});

export const adminStatus = createServerFn({ method: "GET" }).handler(async () => {
  const { adminSession } = await import("./admin-session.server");
  const session = await adminSession();
  return { unlocked: session.data.unlocked === true };
});

export const adminQueue = createServerFn({ method: "GET" }).handler(async () => {
  const { requireAdmin } = await import("./admin-session.server");
  await requireAdmin();
  const { serviceClient } = await import("@/lib/supabase-clients");
  const db = serviceClient();
  const [reports, markets] = await Promise.all([
    db
      .from("market_reports")
      .select("id, question_id, onchain_id, reason, details, resolved, created_at")
      .eq("resolved", false)
      .order("created_at", { ascending: false })
      .limit(100),
    db
      .from("conviction_markets")
      .select(
        "question_id, onchain_id, question, creator_wallet, hidden, moderation_status, status, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  return { reports: reports.data ?? [], markets: markets.data ?? [] };
});

/** Hide or restore a market's off-chain presentation. The chain is untouched. */
export const adminSetVisibility = createServerFn({ method: "POST" })
  .inputValidator((data: { questionId: string; hidden: boolean; blocked?: boolean }) => data)
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const { serviceClient } = await import("@/lib/supabase-clients");
    const { error } = await serviceClient()
      .from("conviction_markets")
      .update({
        hidden: data.hidden,
        moderation_status: data.blocked ? "blocked" : data.hidden ? "hidden" : "ok",
      })
      .eq("question_id", data.questionId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const adminResolveReport = createServerFn({ method: "POST" })
  .inputValidator((data: { id: string; note?: string | null }) => data)
  .handler(async ({ data }) => {
    const { requireAdmin } = await import("./admin-session.server");
    await requireAdmin();
    const { serviceClient } = await import("@/lib/supabase-clients");
    const { error } = await serviceClient()
      .from("market_reports")
      .update({ resolved: true, resolution_note: data.note ?? null })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
