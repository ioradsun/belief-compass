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
    /**
     * WHOSE MARKETS — the one filter the Insider column offers.
     *
     * NOT A SECOND FEED, AND THE SCHEMA IS WHERE THAT IS DECIDED. This is a
     * scope on the existing tape, exactly like `marketIds` and `side` above it:
     * same events, same grouping, same narration, same delta sync. A separate
     * endpoint for "my markets" would have been a second event system that
     * happened to read the same table, and the two would have drifted the first
     * time either one learned a new row kind.
     *
     *   all   the curated pulse of the whole network — significance-scored,
     *         family-capped, paced. The default, and unchanged.
     *   mine  markets I opened. Every grouped row, newest first, with no
     *         significance floor: in your own question a $25 buy is not noise,
     *         it is the entire point.
     *
     * DELIBERATELY NOT `marketIds`. Scoping by id would cap at 60 markets and
     * ship the whole list on every poll; the server already knows who authored
     * what, so it resolves the set itself and a prolific creator is not silently
     * truncated.
     */
    scope: z.enum(["all", "mine"]).optional(),
  })
  .optional();
