/**
 * Thin RPC surface over the data contract. Module scope holds only imports and
 * exported server-function declarations — all logic lives in
 * conviction-contract.server.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const addr = z.object({ address: z.string().trim().nullable() });

export const getViewerFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => addr.parse(d))
  .handler(async ({ data }) => {
    const { getViewer } = await import("@/lib/conviction-contract.server");
    return getViewer(data.address);
  });

export const getPositionsFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => addr.parse(d))
  .handler(async ({ data }) => {
    const { getPositions } = await import("@/lib/conviction-contract.server");
    return getPositions(data.address);
  });

export const getBeliefFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({ beliefId: z.string().min(1), address: z.string().trim().nullable() }).parse(d),
  )
  .handler(async ({ data }) => {
    const { getBelief } = await import("@/lib/conviction-contract.server");
    return getBelief(data.beliefId, data.address);
  });

export const getRoomFeedFn = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) =>
    z.object({ address: z.string().trim().nullable(), limit: z.number().int().min(1).max(50).default(24) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { getRoomFeed } = await import("@/lib/conviction-contract.server");
    return getRoomFeed(data.address, data.limit);
  });

export const getOnboardingBeliefsFn = createServerFn({ method: "GET" }).handler(async () => {
  const { getOnboardingBeliefs } = await import("@/lib/conviction-contract.server");
  return getOnboardingBeliefs();
});
