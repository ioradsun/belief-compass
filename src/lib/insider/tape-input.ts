/**
 * The one query shape the live tape accepts. Lives apart from the server fn so
 * the source layer can type its loaders without importing the whole pipeline.
 */
import { z } from "zod";

export const tapeInput = z
  .object({
    limit: z.number().int().min(1).max(300).optional(),
    wallet: z.string().min(3).optional(),
    /** Scope the tape to specific markets (center deck, position rows). */
    marketIds: z.array(z.number().int()).min(1).max(60).optional(),
    /**
     * Scope to ONE side of a market — the YES/NO rails. A side panel is asking
     * "what is happening to this belief", so market-wide rows (a market opening,
     * a transition about both sides) are deliberately excluded: the column
     * already sits inside that context and repeating it is noise.
     */
    side: z.enum(["YES", "NO"]).optional(),
    /**
     * Delta sync: only events at/after this ISO time. The client passes its
     * newest event minus an OVERLAP that exceeds every grouping window, so the
     * server re-groups the boundary exactly as a full fetch would — the client
     * then merges these fresh head rows onto its cached (immutable) tail. Omit
     * for a full fetch.
     */
    since: z.string().datetime().optional(),
  })
  .optional();
