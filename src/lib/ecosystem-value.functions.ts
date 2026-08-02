/**
 * The one public entry point for the ecosystem value page. No auth, no wallet —
 * a public report card served from a warm SWR snapshot.
 */
import { createServerFn } from "@tanstack/react-start";
import type { EcosystemValue } from "@/lib/ecosystem-value.server";

export type { EcosystemValue };

export const getEcosystemValue = createServerFn({ method: "GET" }).handler(
  async (): Promise<EcosystemValue> => {
    const { buildEcosystemValue } = await import("@/lib/ecosystem-value.server");
    return buildEcosystemValue();
  },
);
