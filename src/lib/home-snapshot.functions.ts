/**
 * The SSR surface for the unified home snapshot. A thin server-function wrapper
 * on purpose: server functions are split out of the client bundle, and the
 * builder/reader live in `home-snapshot.server.ts` where the server-only deps
 * (Supabase, the feed and tape builds) stay off the wire.
 */
import { createServerFn } from "@tanstack/react-start";
import type { HomeSnapshot } from "@/lib/home-snapshot.server";

export type { HomeSnapshot };

/**
 * Read the published home snapshot for SSR. Peeks this isolate's warm slot, else
 * reads the one durable row — it NEVER builds, so the shell is never hostage to
 * a cold assembly. On a miss (a fresh deploy before the warmer ran) it returns
 * null and the route loader falls back to the individual warm surfaces, so the
 * front door can never regress below what it did before this snapshot existed.
 */
export const getHomeSnapshot = createServerFn({ method: "GET" }).handler(
  async (): Promise<HomeSnapshot | null> => {
    const { warmHomeSnapshot } = await import("@/lib/home-snapshot.server");
    return warmHomeSnapshot();
  },
);
