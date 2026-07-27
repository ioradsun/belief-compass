/**
 * Thin RPC for the POV-positions ingest. Logic lives in
 * conviction-ingest.server.ts; this is the client-callable surface, run once on
 * connect so conviction is real for the viewer immediately.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const ingestConvictionFn = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => z.object({ address: z.string().trim().nullable() }).parse(d))
  .handler(async ({ data }) => {
    const { ingestPositions } = await import("@/lib/conviction-ingest.server");
    return ingestPositions(data.address);
  });
