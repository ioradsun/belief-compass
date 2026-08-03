/**
 * Viewer feed signals (server).
 *
 * ONE place loads everything personal the feed is allowed to know, all of it
 * already-computed state: decisions, interaction cooldowns, held positions,
 * category/topic/creator affinity and the viewer's taste embedding. Bounded
 * queries only — the feed never runs DNA or scoring inline.
 */
import { serviceClient } from "@/lib/supabase-clients";
import type { ViewerMarketState } from "@/domain/feed/eligibility";
import { EMPTY_PROFILE, type ViewerProfile } from "@/domain/feed/score";

export interface ViewerSignals {
  states: Map<number, ViewerMarketState>;
  profile: ViewerProfile;
  /** Markets the viewer currently holds a position in. */
  held: Set<number>;
}

export const EMPTY_SIGNALS: ViewerSignals = {
  states: new Map(),
  profile: EMPTY_PROFILE,
  held: new Set(),
};

type EventRow = { market_id: number; kind: string; count: number; last_at: string };
type DecisionRow = { market_id: number; decision: string; decided_at?: string | null };
type BeliefRow = {
  onchain_id: number;
  yes_shares: number | null;
  no_shares: number | null;
  stance_side: string | null;
  last_trade_at: string | null;
};

function mean(vectors: number[][]): number[] | null {
  if (vectors.length === 0) return null;
  const dim = vectors[0]!.length;
  const out = new Array<number>(dim).fill(0);
  for (const v of vectors) {
    if (v.length !== dim) continue;
    for (let i = 0; i < dim; i += 1) out[i]! += v[i]!;
  }
  return out.map((x) => x / vectors.length);
}

function normalize(counts: Map<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  const max = Math.max(1, ...counts.values());
  for (const [k, n] of counts) out[k] = n / max;
  return out;
}

/**
 * Load the viewer's state for the markets currently in play, plus a capped slice
 * of their own history for affinity. Best-effort: any failure degrades to the
 * empty profile rather than emptying the feed.
 */
export async function loadViewerSignals(
  wallet: string,
  marketIds: number[],
): Promise<ViewerSignals> {
  const w = wallet.toLowerCase();
  const sb = serviceClient();
  const states = new Map<number, ViewerMarketState>();
  const put = (id: number, patch: Partial<ViewerMarketState>) => {
    states.set(id, { ...(states.get(id) ?? {}), ...patch });
  };

  const [events, decisions, beliefs, history] = await Promise.all([
    sb
      .from("viewer_market_events")
      .select("market_id, kind, count, last_at")
      .eq("viewer_wallet", w),
    sb.from("viewer_market_decisions").select("market_id, decision, decided_at").eq("viewer_wallet", w),
    sb
      .from("wallet_beliefs")
      .select("onchain_id, yes_shares, no_shares, stance_side, last_trade_at")
      .eq("wallet", w),
    sb
      .from("wallet_beliefs")
      .select("onchain_id")
      .eq("wallet", w)
      .in("stance_side", ["YES", "NO"])
      .order("last_trade_at", { ascending: false, nullsFirst: false })
      .limit(200),
  ]);

  for (const e of (events.data ?? []) as unknown as EventRow[]) {
    const id = Number(e.market_id);
    const at = e.last_at;
    if (e.kind === "view") put(id, { viewedAt: at });
    else if (e.kind === "open") put(id, { openedAt: at });
    else if (e.kind === "hide") put(id, { hiddenAt: at });
    else if (e.kind === "sold") put(id, { soldAt: at });
    else if (e.kind === "pass") put(id, { passedAt: at, passCount: Number(e.count ?? 1) });
  }

  for (const d of (decisions.data ?? []) as unknown as DecisionRow[]) {
    const id = Number(d.market_id);
    if (d.decision === "PASS") {
      const prev = states.get(id);
      put(id, {
        passedAt: prev?.passedAt ?? d.decided_at ?? new Date().toISOString(),
        passCount: prev?.passCount ?? 1,
      });
    }
  }

  const held = new Set<number>();
  for (const b of (beliefs.data ?? []) as unknown as BeliefRow[]) {
    const id = Number(b.onchain_id);
    const open = Number(b.yes_shares ?? 0) > 0 || Number(b.no_shares ?? 0) > 0;
    if (open) {
      held.add(id);
      put(id, { activePosition: true });
    } else if (b.last_trade_at) {
      // Traded here before but holds nothing now — a fully-sold position.
      put(id, { soldAt: states.get(id)?.soldAt ?? b.last_trade_at });
    }
  }

  // Affinity + taste embedding from the markets this person actually acted on.
  const historyIds = ((history.data ?? []) as { onchain_id: number }[]).map((h) =>
    Number(h.onchain_id),
  );
  const categories = new Map<string, number>();
  const topics = new Map<string, number>();
  const creators = new Map<string, number>();
  const vectors: number[][] = [];

  if (historyIds.length) {
    const [mkts, ai] = await Promise.all([
      sb.from("markets").select("onchain_id, category, author_wallet").in("onchain_id", historyIds),
      sb
        .from("market_ai_analysis")
        .select("onchain_id, category, topic, embedding")
        .in("onchain_id", historyIds),
    ]);
    for (const m of (mkts.data ?? []) as {
      category: string | null;
      author_wallet: string | null;
    }[]) {
      if (m.category) categories.set(m.category, (categories.get(m.category) ?? 0) + 1);
      if (m.author_wallet) {
        const a = m.author_wallet.toLowerCase();
        creators.set(a, (creators.get(a) ?? 0) + 1);
      }
    }
    for (const a of (ai.data ?? []) as {
      category: string | null;
      topic: string | null;
      embedding: unknown;
    }[]) {
      if (a.topic) topics.set(a.topic, (topics.get(a.topic) ?? 0) + 1);
      if (Array.isArray(a.embedding)) vectors.push((a.embedding as number[]).map(Number));
    }
  }

  // "Never shown" = in the current pool, with no recorded interaction at all.
  const neverShown = new Set<number>(marketIds.filter((id) => !states.has(id)));

  return {
    states,
    held,
    profile: {
      categoryAffinity: normalize(categories),
      topicAffinity: normalize(topics),
      creatorAffinity: normalize(creators),
      tasteEmbedding: mean(vectors),
      neverShown,
    },
  };
}

/** Record a view / open / hide / sold / pass interaction. Best-effort. */
export async function recordViewerMarketEvent(
  wallet: string,
  marketId: number,
  kind: "view" | "open" | "pass" | "hide" | "sold",
): Promise<void> {
  const sb = serviceClient();
  await sb.rpc("record_viewer_market_event", {
    p_wallet: wallet.toLowerCase(),
    p_market: marketId,
    p_kind: kind,
  });
}

/** Stored AI meaning for the markets currently in play. */
export async function loadMarketAnalyses(
  ids: number[],
): Promise<Map<number, Record<string, unknown>>> {
  if (ids.length === 0) return new Map();
  const sb = serviceClient();
  const { data } = await sb
    .from("market_ai_analysis")
    .select(
      "onchain_id, category, subcategory, topic, summary, clarity_score, answerability_score, novelty_score, debate_score, identity_score, time_sensitivity, media_relevance, quality_score, risk_flags, embedding, duplicate_cluster_id, duplicate_similarity",
    )
    .in("onchain_id", ids)
    .eq("status", "ready");
  const out = new Map<number, Record<string, unknown>>();
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    out.set(Number(r.onchain_id), r);
  }
  return out;
}
