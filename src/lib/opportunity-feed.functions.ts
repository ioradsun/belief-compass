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
  seenIds: z.array(z.number().int().nonnegative()).max(200).optional(),
  queuedIds: z.array(z.number().int().nonnegative()).max(200).optional(),
  cardsViewed: z.number().int().nonnegative().max(10_000).optional(),
  cardsSinceIdea: z.number().int().nonnegative().max(10_000).optional(),
  ideasShownThisSession: z.number().int().nonnegative().max(100).optional(),
  limit: z.number().int().min(1).max(60).optional(),
});

export const getOpportunityFeed = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) => input.parse(raw ?? {}))
  .handler(async ({ data }): Promise<OpportunityFeedResult> => {
    const { buildOpportunityFeed } = await import("@/lib/opportunity-feed.server");
    return buildOpportunityFeed(data);
  });

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
