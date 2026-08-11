/**
 * The one feed endpoint. Returns a finished sequence of `market` /
 * `market_idea` items plus the read-model rows to render them. The client does
 * no scoring, sorting or filtering — it renders this order.
 *
 * `recordFeedEvent` is the matching write: the client reports what actually
 * happened (a card was seen, opened, hidden) so the hard-exclusion gate can do
 * its job on the next request.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { OpportunityFeedResult } from "@/lib/opportunity-feed.server";

export type { OpportunityFeedResult };

const input = z.object({
  wallet: z.string().min(3).nullish(),
  sessionToken: z.string().min(16).max(2000).nullish(),
  window: z.enum(["1h", "24h", "7d", "30d", "all"]).optional(),
  lens: z.string().max(32).optional(),
  mode: z.string().max(32).optional(),
  // The reader's own filter grammar. Bounded so a crafted request cannot widen
  // the query.
  //
  // `momentum` AND `sensitivity` WERE MISSING FROM THIS OBJECT, and zod's
  // `.parse` strips unknown keys silently rather than throwing. The client has
  // been sending both on every request (see routes/index.tsx) and the server has
  // been receiving neither — so the seven Momentum checkboxes and the three
  // "How much matters" rows in the filter menu did nothing at all. No error, no
  // type failure, no test: ten of the menu's ~24 rows were inert. A validator is
  // a CONTRACT, and a field the caller sends but the schema omits is the one
  // shape of breakage nothing downstream can detect.
  networks: z.array(z.string().max(20)).max(8).optional(),
  topics: z.array(z.string().max(24)).max(24).optional(),
  momentum: z.array(z.string().max(20)).max(12).optional(),
  sensitivity: z.string().max(20).optional(),
  originMarketId: z.number().int().nonnegative().nullish(),
  seenIds: z.array(z.number().int().nonnegative()).max(500).optional(),
  queuedIds: z.array(z.number().int().nonnegative()).max(200).optional(),
  /** How deep into the catalogue to retrieve — see @/domain/feed/pool. */
  poolPage: z.number().int().min(0).max(64).optional(),
  /** When the reader's current pass began, epoch ms — see the eligibility gate. */
  cycleStartedAt: z.number().int().nonnegative().max(1e15).optional(),

  cardsViewed: z.number().int().nonnegative().max(10_000).optional(),
  cardsSinceIdea: z.number().int().nonnegative().max(10_000).optional(),
  ideasShownThisSession: z.number().int().nonnegative().max(100).optional(),
  limit: z.number().int().min(1).max(60).optional(),
});

export const getOpportunityFeed = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) => input.parse(raw ?? {}))
  .handler(async ({ data }): Promise<OpportunityFeedResult> => {
    const { opportunityFeed } = await import("@/lib/opportunity-feed.server");
    return opportunityFeed(data);
  });

/**
 * The SSR read. Never builds: it returns this isolate's warm snapshot, and on a
 * cold isolate falls back to the stored SEED — the first few finished cards,
 * one indexed row — so the shell still paints a real market. Either way the
 * browser fetches the full feed right after.
 */
export const getWarmFeed = createServerFn({ method: "GET" }).handler(
  async (): Promise<OpportunityFeedResult | null> => {
    const { warmAnonFeed } = await import("@/lib/opportunity-feed.server");
    return warmAnonFeed();
  },
);

const eventInput = z.object({
  wallet: z.string().min(3),
  marketId: z.number().int().nonnegative(),
  kind: z.enum(["view", "open", "pass", "hide", "sold"]),
});

export const recordFeedEvent = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) => eventInput.parse(raw))
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    try {
      const { recordViewerMarketEvent } = await import("@/lib/feed/viewer-signals.server");
      await recordViewerMarketEvent(data.wallet, data.marketId, data.kind);
      return { ok: true };
    } catch {
      // Telemetry must never break browsing.
      return { ok: false };
    }
  });
