/**
 * CHALLENGE — deriving open calls, and recording the ones that were made.
 *
 * THE SPLIT THIS FILE IS BUILT AROUND:
 *
 *   DERIVED    "What is open right now?" — a live question about current state.
 *              Qualified people, their recent acts, minus what I have answered.
 *              Nothing is stored to answer it, so it can never be stale or wrong.
 *
 *   PERSISTED  "Which calls happened, under what relationship, and were they
 *              answered?" — past social behaviour, which must not change when a
 *              relationship later does. See the market_calls migration.
 *
 * A call row is written at the moment a Challenge is SURFACED, which is the
 * honest definition of a call having been made: one nobody was ever shown did
 * not happen. That is also what freezes `relation_at_call` early enough to
 * matter — freezing at answer time would leave days of drift.
 *
 * EVERY READ IS BOUNDED. `viewer_dna_cache`, `wallet_beliefs` and `market_calls`
 * are service-role only and `events` is large; none of these paths may become a
 * graph traversal. Caps are named constants rather than bare `.limit()` calls.
 */
import { serviceClient } from "@/lib/supabase-clients";
import { aliasFor } from "@/lib/wallet-identity";
import {
  composeChallenges,
  answeredNotices,
  type AnsweredNotice,
  type CallEvidence,
  type CallerRelation,
  type Challenge,
  type CallReach,
} from "@/domain/challenge";

/** Bounds. A panel of six open questions is not a feed builder. */
const READ = {
  /** People pulled from each DNA bucket. */
  peoplePerBucket: 40,
  /** Recent events read across all qualified callers. */
  callerEvents: 400,
  /** How far back an act can be and still be a live call. */
  windowDays: 30,
  /** Answered-call notices read. */
  answers: 20,
} as const;

/** jsonb rows in viewer_dna_cache carry more than this; only these are read. */
interface CachedRelationship {
  wallet?: string | null;
}

type Sb = ReturnType<typeof serviceClient>;

/**
 * The viewer's qualified callers, by canonical relationship.
 *
 * ORDER MATTERS ON COLLISION. A wallet in more than one bucket keeps the
 * strongest claim, and the buckets are read strongest-first so the first write
 * wins — the same precedence the domain module applies when ranking.
 */
async function qualifiedCallers(sb: Sb, viewer: string): Promise<Map<string, CallerRelation>> {
  const { data } = await sb
    .from("viewer_dna_cache")
    .select("twin_matches, tribe_matches, opp_matches, inverse_matches")
    .eq("viewer_wallet", viewer)
    .maybeSingle();

  const out = new Map<string, CallerRelation>();
  const take = (rows: unknown, relation: CallerRelation) => {
    for (const r of ((rows as CachedRelationship[] | null) ?? []).slice(0, READ.peoplePerBucket)) {
      const w = r?.wallet ? String(r.wallet).toLowerCase() : null;
      if (w && w !== viewer && !out.has(w)) out.set(w, relation);
    }
  };
  take(data?.twin_matches, "twin");
  take(data?.inverse_matches, "inverse");
  take(data?.opp_matches, "opp");
  take(data?.tribe_matches, "tribe");
  return out;
}

/**
 * OPEN CHALLENGES for one viewer, and the call rows they create.
 *
 * Returns `[]` for a viewer with no qualified callers, which today is most of
 * them — 95% of wallets have no Tribe and no wallet has a Rival. An empty panel
 * is the correct state, not a failure, and nothing here manufactures a caller to
 * avoid it.
 */
export async function buildChallenges(viewer: string): Promise<Challenge[]> {
  const me = viewer.toLowerCase();
  const sb = serviceClient();

  const [callers, mine] = await Promise.all([
    qualifiedCallers(sb, me),
    // Every market the viewer has taken a side in. The exclusion that makes
    // this a set of OPEN questions rather than a list of markets with friends.
    sb
      .from("wallet_beliefs")
      .select("onchain_id")
      .eq("wallet", me)
      .in("stance_side", ["YES", "NO"]),
  ]);
  if (callers.size === 0) return [];

  const answered = new Set(
    ((mine.data ?? []) as { onchain_id: number }[]).map((r) => Number(r.onchain_id)),
  );

  const since = new Date(Date.now() - READ.windowDays * 86_400_000).toISOString();
  const { data: acts, error } = await sb
    .from("events")
    .select("wallet, market_id, kind, side, occurred_at")
    .in("wallet", [...callers.keys()])
    .in("kind", ["trade", "market_created"])
    .eq("is_canonical", true)
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(READ.callerEvents);
  // Loudly, then degrade. A blocked or failed read comes back as `data: null`
  // with an error set, and swallowing it turns the whole social surface off
  // silently and forever — the failure shape this codebase keeps paying for.
  if (error) {
    console.error("[challenge] events unreadable — no calls can be derived", {
      code: error.code,
      message: error.message,
    });
    return [];
  }

  type Act = {
    wallet: string;
    market_id: string | null;
    kind: string;
    side: string | null;
    occurred_at: string;
  };
  // `events.market_id` is TEXT while `markets.onchain_id` is numeric, so this
  // crosses a type boundary. A non-numeric id is dropped rather than becoming
  // NaN and matching nothing downstream in a way nobody can see.
  const candidates = ((acts ?? []) as Act[])
    .map((a) => ({
      wallet: String(a.wallet).toLowerCase(),
      marketId: Number(a.market_id),
      act: a.kind === "market_created" ? ("market_created" as const) : ("trade" as const),
      // Narrowed here rather than trusted: `events.side` is a free text column
      // and a trade whose side we cannot name is one the domain refuses.
      side: a.side === "YES" || a.side === "NO" ? (a.side as "YES" | "NO") : null,
      atMs: Date.parse(a.occurred_at),
    }))
    .filter((a) => Number.isFinite(a.marketId) && !answered.has(a.marketId));
  if (candidates.length === 0) return [];

  const marketIds = [...new Set(candidates.map((a) => a.marketId))];
  const wallets = [...new Set(candidates.map((a) => a.wallet))];

  const { resolveProfiles } = await import("@/lib/profiles.server");
  const [{ data: markets }, profiles] = await Promise.all([
    sb.from("markets").select("onchain_id, title").in("onchain_id", marketIds),
    resolveProfiles(wallets, 0),
  ]);
  const titleOf = new Map(
    ((markets ?? []) as { onchain_id: number; title: string | null }[])
      .filter((m) => m.title)
      .map((m) => [Number(m.onchain_id), String(m.title)]),
  );

  const evidence: CallEvidence[] = [];
  for (const a of candidates) {
    const title = titleOf.get(a.marketId);
    const relation = callers.get(a.wallet);
    if (!title || !relation) continue;
    evidence.push({
      marketId: a.marketId,
      title,
      // A wallet with no profile still has a stable readable handle. The domain
      // refuses an unnamed caller, so passing the alias is what keeps a real
      // relationship from being silently dropped for want of a display name.
      caller: {
        wallet: a.wallet,
        name: profiles.get(a.wallet)?.displayName?.trim() || aliasFor(a.wallet),
      },
      relation,
      act: a.act,
      callerSide: a.side,
      atMs: Number.isFinite(a.atMs) ? a.atMs : Date.now(),
    });
  }

  const open = composeChallenges(evidence, { answered });
  // Surfacing IS the call. Recorded fire-and-forget: a failed ledger write costs
  // a future Dependability data point, never this render.
  if (open.length > 0) void recordCalls(sb, me, open);
  return open;
}

/**
 * Write the call rows for Challenges just surfaced.
 *
 * PLAIN INSERT, NOT UPSERT, and 23505 is swallowed on purpose — a repeat must
 * never rewrite `relation_at_call`, which is the one thing this table exists to
 * hold still. The primary key does the deduplication; this only has to not
 * fight it.
 */
async function recordCalls(sb: Sb, responder: string, open: readonly Challenge[]): Promise<void> {
  const { error } = await sb.from("market_calls").insert(
    open.map((c) => ({
      market_id: c.marketId,
      caller_wallet: c.caller.wallet,
      responder_wallet: responder,
      relation_at_call: c.relation,
    })),
  );
  if (error && error.code !== "23505") {
    console.error("[challenge] could not record calls", {
      code: error.code,
      message: error.message,
    });
  }
}

/**
 * The responder took a side — close every open call addressed to them here.
 *
 * Only open calls are stamped (`responded_at IS NULL`), so the recorded time is
 * when they FIRST answered. Overwriting it on every later trade would turn
 * "when did they show up" into "when were they last here", which is a different
 * and much less useful fact.
 */
export async function markCallsAnswered(wallet: string, marketId: number): Promise<void> {
  const sb = serviceClient();
  const { error } = await sb
    .from("market_calls")
    .update({ responded_at: new Date().toISOString() })
    .eq("market_id", marketId)
    .eq("responder_wallet", wallet.toLowerCase())
    .is("responded_at", null);
  if (error) {
    console.error("[challenge] could not stamp answers", {
      code: error.code,
      message: error.message,
    });
  }
}

/**
 * WHO GOT THE CALL — the counts shown after a market is created or a side taken.
 *
 * Deliberately NOT read from `market_calls`: at the moment of creation no call
 * has been surfaced to anyone yet, so the ledger is empty and would report zero.
 * This answers the different and correct question — how many qualified people
 * this market is now eligible to reach.
 */
export async function callReachFor(wallet: string): Promise<CallReach> {
  const sb = serviceClient();
  const callers = await qualifiedCallers(sb, wallet.toLowerCase());
  let tribe = 0;
  let rivals = 0;
  for (const relation of callers.values()) {
    if (relation === "twin" || relation === "tribe") tribe += 1;
    else rivals += 1;
  }
  return { tribe, rivals };
}

/**
 * SARAH SHOWED UP — calls this viewer's own conviction created, that somebody
 * answered.
 *
 * This is the only event that counts toward Dependability, and the precision is
 * the point: not "Sarah participated in something I participated in", which on
 * a small platform is ordinary coincidence, but "my act created a call for
 * Sarah and Sarah answered it". The ledger holds the causal edge; this reads it.
 */
export async function answeredForMe(wallet: string): Promise<AnsweredNotice[]> {
  const me = wallet.toLowerCase();
  const sb = serviceClient();
  const { data, error } = await sb
    .from("market_calls")
    .select("market_id, responder_wallet, responded_at")
    .eq("caller_wallet", me)
    .not("responded_at", "is", null)
    .order("responded_at", { ascending: false })
    .limit(READ.answers);
  if (error) {
    console.error("[challenge] answered calls unreadable", {
      code: error.code,
      message: error.message,
    });
    return [];
  }

  const rows = (data ?? []) as {
    market_id: number;
    responder_wallet: string;
    responded_at: string;
  }[];
  if (rows.length === 0) return [];

  const { resolveProfiles } = await import("@/lib/profiles.server");
  const [{ data: markets }, profiles] = await Promise.all([
    sb
      .from("markets")
      .select("onchain_id, title")
      .in("onchain_id", [...new Set(rows.map((r) => Number(r.market_id)))]),
    resolveProfiles(
      rows.map((r) => String(r.responder_wallet).toLowerCase()),
      0,
    ),
  ]);
  const titleOf = new Map(
    ((markets ?? []) as { onchain_id: number; title: string | null }[])
      .filter((m) => m.title)
      .map((m) => [Number(m.onchain_id), String(m.title)]),
  );

  return answeredNotices(
    rows.flatMap((r) => {
      const title = titleOf.get(Number(r.market_id));
      if (!title) return [];
      const w = String(r.responder_wallet).toLowerCase();
      return [
        {
          marketId: Number(r.market_id),
          title,
          responder: { wallet: w, name: profiles.get(w)?.displayName?.trim() || aliasFor(w) },
          respondedAtMs: Date.parse(r.responded_at),
        },
      ];
    }),
  );
}
