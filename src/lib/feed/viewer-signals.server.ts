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
import { loadFollowing } from "@/lib/follows.functions";
import { ORIGIN } from "@/domain/feed/config";

/**
 * Who else is where the viewer just arrived.
 *
 * When a market is opened from OUTSIDE the running order — a search result, a
 * Live row, one of their own positions — the people holding a side in it are
 * the thread that carries them onward. This counts, for each market in play,
 * how many of those people are also here.
 *
 * Bounded twice: the origin's believers are capped, and the second read is
 * scoped to the markets already on the board. Returns an empty map for no
 * origin, so the ordinary case of reading down the feed costs nothing.
 */
export async function loadOriginOverlap(
  sb: ReturnType<typeof serviceClient> | null,
  originMarketId: number | null,
  marketIds: number[],
): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  if (!sb || originMarketId == null || marketIds.length === 0) return out;

  const { data: theirs } = await sb
    .from("wallet_beliefs")
    .select("wallet")
    .eq("onchain_id", originMarketId)
    .in("stance_side", ["YES", "NO"])
    .limit(ORIGIN.MAX_PEOPLE);
  const people = [
    ...new Set(((theirs ?? []) as { wallet: string }[]).map((r) => String(r.wallet).toLowerCase())),
  ];
  if (people.length === 0) return out;

  const { data: elsewhere } = await sb
    .from("wallet_beliefs")
    .select("onchain_id, wallet")
    .in("wallet", people)
    .in("onchain_id", marketIds)
    .in("stance_side", ["YES", "NO"]);
  // Distinct people per market: someone holding both sides is one person here.
  const seen = new Map<number, Set<string>>();
  for (const r of (elsewhere ?? []) as { onchain_id: number; wallet: string }[]) {
    const id = Number(r.onchain_id);
    // The origin itself is not "connected to" anything — it IS the origin.
    if (id === originMarketId) continue;
    const at = seen.get(id) ?? new Set<string>();
    at.add(String(r.wallet).toLowerCase());
    seen.set(id, at);
  }
  for (const [id, set] of seen) out.set(id, set.size);
  return out;
}

export interface ViewerSignals {
  states: Map<number, ViewerMarketState>;
  profile: ViewerProfile;
  /** Markets the viewer currently holds a position in. */
  held: Set<number>;
  /** Wallets this viewer explicitly follows. */
  following: ReadonlySet<string>;
  /**
   * Which followed people are connected to each market, and which way they went.
   *
   * Keyed by wallet rather than a count, so the caller can UNION in a followed
   * creator without double-counting the common case: someone who created a
   * market and also backed it is one person connected to it, not two.
   *
   * One map, not a creator map and a participant map. The product's rule is
   * that a person is a connection, not a role — whether they wrote the question
   * or took a side in it is a ranking detail the interface never distinguishes,
   * and splitting it here would put that distinction one careless render away
   * from being visible.
   *
   * The VALUE is the side they hold, or null when the only connection is
   * authorship. This used to be a bare `Set<string>`: the query already filtered
   * on `stance_side` and then dropped the column, so the feed knew which way
   * every followed person had gone and could only say "is active here".
   */
  followedInMarket: Map<number, Map<string, FollowedSide>>;
  /**
   * Display names for followed wallets, for the sentence that names one. Absent
   * when a wallet has no POV identity — the copy then falls back to "someone you
   * follow" rather than printing an address at a reader.
   */
  followedNames: ReadonlyMap<string, string>;
}

/** Which side a followed person took here. Null = connected as the creator only. */
export type FollowedSide = "YES" | "NO" | null;

export const EMPTY_SIGNALS: ViewerSignals = {
  states: new Map(),
  profile: EMPTY_PROFILE,
  held: new Set(),
  following: new Set(),
  followedInMarket: new Map(),
  followedNames: new Map(),
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

  const [events, decisions, beliefs, history, following] = await Promise.all([
    sb
      .from("viewer_market_events")
      .select("market_id, kind, count, last_at")
      .eq("viewer_wallet", w),
    sb
      .from("viewer_market_decisions")
      .select("market_id, decision, decided_at")
      .eq("viewer_wallet", w),
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
    loadFollowing(sb, w),
  ]);

  /**
   * Followed people with a position in the markets currently in play, AND WHICH
   * SIDE. One bounded query over (their wallets × these market ids) — the same
   * shape the DNA overlay already uses for tribe/opp, and the reason a follow can
   * say something specific ("Reyhan is backing YES") instead of only nudging a
   * score.
   *
   * `stance_side` was already in the filter and dropped from the select, so the
   * side was computed by the database and thrown away on arrival.
   */
  const followedInMarket = new Map<number, Map<string, FollowedSide>>();
  const seenWallets = new Set<string>();
  if (following.size > 0 && marketIds.length > 0) {
    const { data: theirs } = await sb
      .from("wallet_beliefs")
      .select("onchain_id, wallet, stance_side")
      .in("wallet", [...following])
      .in("onchain_id", marketIds)
      .in("stance_side", ["YES", "NO"]);
    // A Map keyed by wallet, so one wallet holding both sides is one person who
    // is here rather than two.
    for (const r of (theirs ?? []) as {
      onchain_id: number;
      wallet: string;
      stance_side: string | null;
    }[]) {
      const id = Number(r.onchain_id);
      const w = String(r.wallet).toLowerCase();
      const at = followedInMarket.get(id) ?? new Map<string, FollowedSide>();
      at.set(w, r.stance_side === "YES" || r.stance_side === "NO" ? r.stance_side : null);
      followedInMarket.set(id, at);
      seenWallets.add(w);
    }
  }

  /**
   * Names for the followed people who actually turned up, resolved ONCE for the
   * whole feed. Bounded by who is present rather than by the follow list, and
   * the lazy cap is deliberately small: a name is worth one cached lookup, never
   * a stall on the feed's critical path.
   */
  const followedNames = new Map<string, string>();
  if (seenWallets.size > 0) {
    const profiles = await import("@/lib/profiles.server")
      .then((m) => m.resolveProfiles([...seenWallets], 5))
      .catch(() => new Map());
    for (const [w, p] of profiles) {
      if (p.displayName) followedNames.set(w, p.displayName);
    }
  }

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
    following,
    followedInMarket,
    followedNames,
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
/**
 * Everything except the vector. `embedding` is deliberately absent here — see
 * `loadMarketAnalyses`, which adds it only when there is something to compare
 * it against.
 */
const ANALYSIS_COLUMNS =
  "onchain_id, category, subcategory, topic, summary, clarity_score, answerability_score, " +
  "novelty_score, debate_score, identity_score, time_sensitivity, media_relevance, " +
  "quality_score, risk_flags, duplicate_cluster_id, duplicate_similarity";

/**
 * AI analysis for a set of markets.
 *
 * THE EMBEDDING IS OPTIONAL, AND THAT IS THE WHOLE POINT. It is the one wide
 * column in this table — a vector per market — and it has exactly one consumer:
 * `cosine(viewer.tasteEmbedding, ai.embedding)` in the personal score.
 *
 * A viewer with no taste vector makes that term structurally zero. `cosine`
 * returns 0 the moment either side is null, so every byte of every embedding is
 * fetched, transferred, JSON-parsed and then multiplied by nothing.
 *
 * AND THAT IS PRECISELY THE SSR PATH. An anonymous request gets `EMPTY_SIGNALS`,
 * whose profile carries `tasteEmbedding: null` — always, by construction, not by
 * accident of data. So the `/` loader, which is what sets TTFB for a first-time
 * visitor's first paint, was paying for a column it could not use. Personalised
 * requests still get it, because for them the term is real.
 */
export async function loadMarketAnalyses(
  ids: number[],
  withEmbedding = false,
): Promise<Map<number, Record<string, unknown>>> {
  if (ids.length === 0) return new Map();
  const sb = serviceClient();
  const { data } = await sb
    .from("market_ai_analysis")
    .select(withEmbedding ? `${ANALYSIS_COLUMNS}, embedding` : ANALYSIS_COLUMNS)
    .in("onchain_id", ids)
    .eq("status", "ready");
  const out = new Map<number, Record<string, unknown>>();
  // Through `unknown`: a select built at runtime defeats supabase-js's
  // literal-type inference, so it widens the row to its error shape. The rows
  // are opaque JSON to every consumer anyway — `aiOf` reads them by key and
  // yields `embedding: null` when the column is absent, which is exactly the
  // value an anonymous viewer's cosine term needs.
  for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
    out.set(Number(r.onchain_id), r);
  }
  return out;
}
