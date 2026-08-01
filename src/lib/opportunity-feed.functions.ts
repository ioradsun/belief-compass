/**
 * The one feed endpoint. Returns a finished sequence of `market` /
 * `market_idea` items plus the read-model rows to render them. The client does
 * no scoring, sorting or filtering — it renders this order.
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
