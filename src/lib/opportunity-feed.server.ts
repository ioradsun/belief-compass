/**
 * Server side of the unified opportunity feed.
 *
 * One place assembles everything the center column shows: the global market
 * read-model, the viewer's real personal facts, and the ready market idea. The
 * pure sequencer in `@/domain/opportunity-feed` then decides the order. The
 * client receives a finished sequence and renders it as-is.
 */
import { serviceClient } from "@/lib/supabase-clients";
import {
  sequenceFeed,
  EMPTY_VIEWER_CONTEXT,
  type FeedMarketCandidate,
  type FeedIdeaCandidate,
  type ViewerFeedContext,
  type OpportunityFeedItem,
} from "@/domain/opportunity-feed";
import { shouldInsertSuggestion } from "@/domain/market-suggestion";
import { listFeed, type VolumeWindow } from "@/lib/markets.functions";

export interface FeedSessionState {
  /** Market ids already shown to this viewer in this browsing session. */
  seenIds?: number[];
  cardsViewed?: number;
  cardsSinceIdea?: number;
  ideasShownThisSession?: number;
}

export interface OpportunityFeedInput extends FeedSessionState {
  wallet?: string | null;
  /** Signed wallet session — required before any personal idea is offered. */
  sessionToken?: string | null;
  window?: VolumeWindow;
  /** Opportunity classification filter chosen by the viewer, or "all". */
  lens?: string;
  limit?: number;
}

type Row = Record<string, unknown> & { onchain_id: number };

/**
 * The viewer's real facts, bounded to the markets currently in the feed plus a
 * capped slice of their own history. Everything here is already-computed state
 * — the feed never runs DNA or scoring inline.
 */
async function viewerContext(
  wallet: string,
  rows: Row[],
): Promise<ViewerFeedContext> {
  const sb = serviceClient();
  const ids = rows.map((r) => Number(r.onchain_id));
  const w = wallet.toLowerCase();

  const [beliefs, decided, history] = await Promise.all([
    sb
      .from("wallet_beliefs")
      .select("onchain_id, yes_shares, no_shares")
      .eq("wallet", w)
      .in("onchain_id", ids),
    sb
      .from("house_predictions")
      .select("onchain_id")
      .eq("wallet", w)
      .not("actual_action", "is", null)
      .in("onchain_id", ids),
    sb
      .from("wallet_beliefs")
      .select("onchain_id")
      .eq("wallet", w)
      .in("stance_side", ["YES", "NO"])
      .order("last_trade_at", { ascending: false, nullsFirst: false })
      .limit(200),
  ]);

  const heldMarkets = (beliefs.data ?? [])
    .filter((b) => Number(b.yes_shares ?? 0) > 0 || Number(b.no_shares ?? 0) > 0)
    .map((b) => Number(b.onchain_id));
  const decidedMarkets = (decided.data ?? []).map((d) => Number(d.onchain_id));

  // Category affinity: which categories this person actually takes sides in.
  const historyIds = (history.data ?? []).map((h) => Number(h.onchain_id));
  const affinity: Record<string, number> = {};
  if (historyIds.length) {
    const { data: cats } = await sb
      .from("markets")
      .select("onchain_id, category")
      .in("onchain_id", historyIds);
    const counts = new Map<string, number>();
    for (const c of cats ?? []) {
      const cat = (c.category as string | null) ?? null;
      if (!cat) continue;
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    const max = Math.max(1, ...counts.values());
    for (const [cat, n] of counts) affinity[cat] = n / max;
  }

  // Tribe / opp presence is already resolved per row by the feed read.
  const tribeMarkets = rows.filter((r) => r["tribe_side"]).map((r) => Number(r.onchain_id));
  const oppMarkets = rows.filter((r) => r["opp_side"]).map((r) => Number(r.onchain_id));

  return { categoryAffinity: affinity, tribeMarkets, oppMarkets, heldMarkets, decidedMarkets };
}

/** The ready idea for this viewer, if the session gate also allows one now. */
async function ideaFor(
  wallet: string | null,
  sessionToken: string | null,
  s: FeedSessionState,
): Promise<{ idea: FeedIdeaCandidate | null; raw: unknown }> {
  if (!wallet || !sessionToken) return { idea: null, raw: null };
  const allowed = shouldInsertSuggestion({
    cardsViewed: s.cardsViewed ?? 0,
    cardsSinceSuggestion: s.cardsSinceIdea ?? Number.POSITIVE_INFINITY,
    suggestionsThisSession: s.ideasShownThisSession ?? 0,
    dismissedAt: null, // server-side cooldowns already gate the stored suggestion
    createdAt: null,
    hasReadySuggestion: true,
  });
  if (!allowed) return { idea: null, raw: null };
  try {
    const { assertWalletOwnership } = await import("@/lib/wallet-session.server");
    const w = await assertWalletOwnership(wallet, sessionToken);
    const { readySuggestionFor } = await import("@/lib/market-suggestion.server");
    const ready = await readySuggestionFor(w);
    if (!ready) return { idea: null, raw: null };
    return {
      idea: {
        id: ready.id,
        question: ready.question,
        category: ready.category,
        shortReason: ready.shortReason,
      },
      raw: ready,
    };
  } catch {
    // A missing session, an expired signature or a generation failure must
    // never degrade the market feed.
    return { idea: null, raw: null };
  }
}

export interface OpportunityFeedResult {
  items: OpportunityFeedItem[];
  /** The full read-model row for each `market` item, keyed by onchain_id. */
  rows: Record<number, unknown>;
  /** The suggestion payload behind a `market_idea` item, when present. */
  idea: unknown;
  window: VolumeWindow;
  ethUsd: number;
  historyFrom: string | null;
  tribe: unknown;
  opp: unknown;
  error: string | null;
}

export async function buildOpportunityFeed(
  input: OpportunityFeedInput,
): Promise<OpportunityFeedResult> {
  const win: VolumeWindow = input.window ?? "24h";
  const wallet = input.wallet?.toLowerCase() ?? null;

  const feed = await listFeed({ data: { window: win, ...(wallet ? { wallet } : {}) } });
  const all = (feed.data ?? []) as unknown as Row[];
  const lens = input.lens && input.lens !== "all" ? input.lens : null;
  const rows = lens ? all.filter((r) => r["opportunity_type"] === lens) : all;

  const viewer = wallet && rows.length ? await viewerContext(wallet, rows) : EMPTY_VIEWER_CONTEXT;
  const { idea, raw } = await ideaFor(wallet, input.sessionToken ?? null, input);

  const candidates: FeedMarketCandidate[] = rows.map((r) => ({
    onchainId: Number(r.onchain_id),
    category: ((r["markets"] as { category?: string | null } | null)?.category ?? null) as
      | string
      | null,
    opportunityEligible: Boolean(r["opportunity_eligible"]),
    opportunityScore:
      r["opportunity_score"] == null ? null : Number(r["opportunity_score"] as number),
    opportunityType: (r["opportunity_type"] as string | null) ?? null,
    opportunityReason: (r["opportunity_reason"] as string | null) ?? null,
    windowVolumeUsd:
      r["window_volume_usd"] == null ? null : Number(r["window_volume_usd"] as number),
  }));

  const { items } = sequenceFeed({
    markets: candidates,
    viewer,
    idea,
    ...(input.seenIds ? { seenIds: input.seenIds } : {}),
    ...(input.limit ? { limit: input.limit } : {}),
  });

  const byId: Record<number, unknown> = {};
  for (const r of rows) byId[Number(r.onchain_id)] = r;

  return {
    items,
    rows: byId,
    idea: raw,
    window: win,
    ethUsd: feed.ethUsd ?? 0,
    historyFrom: feed.historyFrom ?? null,
    tribe: feed.tribe ?? null,
    opp: feed.opp ?? null,
    error: feed.error ?? null,
  };
}
