/**
 * The one client entry point for the Conviction Dashboard story data. Indexed,
 * read-only; creator fees are read separately on-chain by the client.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { ConvictionDashboardData } from "@/lib/conviction-dashboard.server";

export type { ConvictionDashboardData };

export const getConvictionDashboard = createServerFn({ method: "GET" })
  .inputValidator((d: { wallet: string }) => z.object({ wallet: z.string().min(3) }).parse(d))
  .handler(async ({ data }): Promise<ConvictionDashboardData> => {
    const { buildConvictionDashboard } = await import("@/lib/conviction-dashboard.server");
    return buildConvictionDashboard(data.wallet);
  });
