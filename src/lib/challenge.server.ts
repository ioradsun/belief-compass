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
  CHALLENGE,
  composeChallenges,
  type CallEvidence,
  type CallerRelation,
  type Challenge,
  type CallReach,
} from "@/domain/challenge";
import {
  EMPTY_TALLY,
  tally,
  type CallFact,
  type HistoryEntry,
  type Tally,
} from "@/domain/dependability";
import type { NamedPerson } from "@/domain/challenge";

/** Bounds. A panel of six open questions is not a feed builder. */
const READ = {
  /** People pulled from each DNA bucket. */
  peoplePerBucket: 40,
  /** Recent events read across all qualified callers. */
  callerEvents: 400,
  /**
   * How far back an act can be and still be a live call.
   *
   * NOT A LOCAL 30. It reads the domain constant because the profile timeline and
   * the showing-up denominator apply the same window, and a second copy here is
   * the version that drifts — the day it did, a profile would show somebody
   * waiting on a call their caller can no longer see.
   */
  windowDays: CHALLENGE.windowDays,
  /** Calls read for one pair's history. */
  pairCalls: 200,
} as const;

/**
 * What the cache rows carry that this path needs.
 *
 * IT USED TO READ ONLY `wallet` and throw the rest away — which meant the
 * Challenge card could not show Conviction Match even though the numbers were
 * already sitting in the row it had just fetched. Same query, same bytes.
 */
interface CachedRelationship {
  wallet?: string | null;
  sameSideBeliefs?: number | null;
  sharedBeliefs?: number | null;
}

/** A qualified caller: how they relate, and the record the two of you have. */
interface Caller {
  relation: CallerRelation;
  together: number | null;
  shared: number | null;
}

type Sb = ReturnType<typeof serviceClient>;

/**
 * The viewer's qualified callers, by canonical relationship.
 *
 * ORDER MATTERS ON COLLISION. A wallet in more than one bucket keeps the
 * strongest claim, and the buckets are read strongest-first so the first write
 * wins — the same precedence the domain module applies when ranking.
 */
async function qualifiedCallers(sb: Sb, viewer: string): Promise<Map<string, Caller>> {
  const { data } = await sb
    .from("viewer_dna_cache")
    .select("twin_matches, tribe_matches, opp_matches, inverse_matches")
    .eq("viewer_wallet", viewer)
    .maybeSingle();

  const out = new Map<string, Caller>();
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const take = (rows: unknown, relation: CallerRelation) => {
    for (const r of ((rows as CachedRelationship[] | null) ?? []).slice(0, READ.peoplePerBucket)) {
      const w = r?.wallet ? String(r.wallet).toLowerCase() : null;
      if (w && w !== viewer && !out.has(w))
        out.set(w, {
          relation,
          together: num(r?.sameSideBeliefs),
          shared: num(r?.sharedBeliefs),
        });
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
    const caller = callers.get(a.wallet);
    if (!title || !caller) continue;
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
      relation: caller.relation,
      act: a.act,
      callerSide: a.side,
      together: caller.together,
      shared: caller.shared,
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
export async function markCallsAnswered(wallet: string, marketId: number): Promise<NamedPerson[]> {
  const sb = serviceClient();
  // `.select()` on the UPDATE returns exactly the rows this call closed — the
  // ones that were still open a moment ago. Reading them separately afterwards
  // would race a second tab and could name somebody this trade did not answer.
  const { data, error } = await sb
    .from("market_calls")
    .update({ responded_at: new Date().toISOString() })
    .eq("market_id", marketId)
    .eq("responder_wallet", wallet.toLowerCase())
    .is("responded_at", null)
    .select("caller_wallet");
  if (error) {
    console.error("[challenge] could not stamp answers", {
      code: error.code,
      message: error.message,
    });
    return [];
  }
  const wallets = [
    ...new Set(
      ((data ?? []) as { caller_wallet: string }[]).map((r) =>
        String(r.caller_wallet).toLowerCase(),
      ),
    ),
  ];
  if (wallets.length === 0) return [];
  const { resolveProfiles } = await import("@/lib/profiles.server");
  const profiles = await resolveProfiles(wallets, 0);
  return wallets.map((w) => ({
    wallet: w,
    name: profiles.get(w)?.displayName?.trim() || aliasFor(w),
  }));
}

/**
 * WHO GOT THE CALL — the counts shown after a market is created or a side taken.
 *
 * Deliberately NOT read from `market_calls`: at the moment of creation no call
 * has been surfaced to anyone yet, so the ledger is empty and would report zero.
 * This answers the different and correct question — how many qualified people
 * this market is now eligible to reach.
 *
 * MARKET-SCOPED. Somebody already holding a directional position in this market
 * cannot receive a call into it — they have already answered the question. When
 * a market id is given, those people are removed from the count, so a backing of
 * an existing market stops overstating the opportunity. A newly created market
 * has no participants, so the number is unchanged there.
 */
export async function callReachFor(wallet: string, marketId?: number): Promise<CallReach> {
  const sb = serviceClient();
  const me = wallet.toLowerCase();
  const callers = await qualifiedCallers(sb, me);

  const already = new Set<string>();
  if (typeof marketId === "number" && Number.isFinite(marketId) && callers.size > 0) {
    const { data, error } = await sb
      .from("wallet_beliefs")
      .select("wallet, stance_side")
      .eq("onchain_id", marketId)
      .in("stance_side", ["YES", "NO"])
      .in("wallet", [...callers.keys()]);
    if (error) {
      console.error("[challenge] could not scope reach to market", {
        code: error.code,
        message: error.message,
      });
    }
    for (const r of (data ?? []) as { wallet: string }[]) {
      already.add(String(r.wallet).toLowerCase());
    }
  }

  let tribe = 0;
  let rivals = 0;
  for (const [caller, { relation }] of callers.entries()) {
    if (already.has(caller.toLowerCase())) continue;
    if (relation === "twin" || relation === "tribe") tribe += 1;
    else rivals += 1;
  }
  return { tribe, rivals };
}


/**
 * ONE RELATIONSHIP, BOTH DIRECTIONS.
 *
 * WHAT THIS REPLACED. `answeredForMe` read one direction — calls I made that
 * somebody answered — capped at three, to fill a dismissible card at the top of
 * the rail. That is half a relationship reported as if it were the whole thing.
 * A relationship is not one person's record of the other, and the reverse rows
 * have been written since the first day without anything ever reading them.
 *
 * So this reads both: what they did when I called, and what I did when they
 * called. Two indexed queries, `market_calls_caller_idx` and
 * `market_calls_responder_idx`, each already covering its direction.
 */
export interface PairCalls {
  /** Calls I made, addressed to them. The denominator for "do they show up". */
  theirs: Tally;
  /** Calls they made, addressed to me. Counted so reciprocity is provable. */
  yours: Tally;
  /** The merged timeline, unlabelled — the domain names each row. */
  history: HistoryEntry[];
}

const EMPTY_PAIR: PairCalls = {
  theirs: { ...EMPTY_TALLY },
  yours: { ...EMPTY_TALLY },
  history: [],
};

interface CallRow {
  market_id: number;
  caller_wallet: string;
  responder_wallet: string;
  called_at: string;
  responded_at: string | null;
}

const CALL_COLUMNS = "market_id, caller_wallet, responder_wallet, called_at, responded_at";

const factOf = (r: CallRow): CallFact => ({
  calledAtMs: Date.parse(r.called_at),
  respondedAtMs: r.responded_at ? Date.parse(r.responded_at) : null,
});

export async function callsWithPerson(viewer: string, person: string): Promise<PairCalls> {
  const me = viewer.toLowerCase();
  const them = person.toLowerCase();
  if (!me || !them || me === them) return EMPTY_PAIR;
  const sb = serviceClient();

  const [mine, hers] = await Promise.all([
    sb
      .from("market_calls")
      .select(CALL_COLUMNS)
      .eq("caller_wallet", me)
      .eq("responder_wallet", them)
      .order("called_at", { ascending: false })
      .limit(READ.pairCalls),
    sb
      .from("market_calls")
      .select(CALL_COLUMNS)
      .eq("caller_wallet", them)
      .eq("responder_wallet", me)
      .order("called_at", { ascending: false })
      .limit(READ.pairCalls),
  ]);

  // Loudly, then degrade. A blocked read here must not become "you have no
  // history with this person", which is the confident-zero this codebase keeps
  // paying for — and here it would erase a real relationship.
  for (const [label, res] of [["theirs", mine] as const, ["yours", hers] as const]) {
    if (res.error) {
      console.error(`[challenge] pair calls unreadable (${label})`, {
        code: res.error.code,
        message: res.error.message,
      });
      return EMPTY_PAIR;
    }
  }

  const now = Date.now();
  const mineRows = (mine.data ?? []) as CallRow[];
  const hersRows = (hers.data ?? []) as CallRow[];
  const theirs = tally(mineRows.map(factOf), now);
  const yours = tally(hersRows.map(factOf), now);

  const ids = [...new Set([...mineRows, ...hersRows].map((r) => Number(r.market_id)))];
  const titleOf = await titlesFor(sb, ids);

  const history: HistoryEntry[] = [];
  for (const r of mineRows) {
    const title = titleOf.get(Number(r.market_id));
    if (!title) continue;
    const answeredMs = r.responded_at ? Date.parse(r.responded_at) : null;
    // An unanswered call that left the window is neither waiting nor a failure —
    // it is simply not part of the story, exactly as it is not part of the count.
    if (answeredMs == null && tally([factOf(r)], now).outOfReach > 0) continue;
    history.push({
      marketId: Number(r.market_id),
      title,
      direction: answeredMs == null ? "waiting_on_them" : "they_answered",
      atMs: answeredMs ?? Date.parse(r.called_at),
    });
  }
  for (const r of hersRows) {
    const title = titleOf.get(Number(r.market_id));
    // Only MY answers appear from this side. A call they made that I never
    // answered is not something to show them waiting on me for — this page is
    // about the relationship, not a list of my own outstanding obligations.
    if (!title || !r.responded_at) continue;
    history.push({
      marketId: Number(r.market_id),
      title,
      direction: "you_answered",
      atMs: Date.parse(r.responded_at),
    });
  }

  return { theirs, yours, history };
}

/**
 * The same counts for many people at once — what the People cards read.
 *
 * Two queries total regardless of how many people are on screen, because a
 * per-person round trip would put the rail's render cost on the network.
 */
export async function dependabilityFor(
  viewer: string,
  wallets: readonly string[],
): Promise<Map<string, { theirs: Tally; yours: Tally }>> {
  const me = viewer.toLowerCase();
  const them = [...new Set(wallets.map((w) => w.toLowerCase()).filter((w) => w && w !== me))];
  const out = new Map<string, { theirs: Tally; yours: Tally }>();
  if (!me || them.length === 0) return out;
  const sb = serviceClient();

  const [mine, hers] = await Promise.all([
    sb
      .from("market_calls")
      .select(CALL_COLUMNS)
      .eq("caller_wallet", me)
      .in("responder_wallet", them),
    sb
      .from("market_calls")
      .select(CALL_COLUMNS)
      .eq("responder_wallet", me)
      .in("caller_wallet", them),
  ]);
  if (mine.error || hers.error) {
    console.error("[challenge] batch pair calls unreadable", {
      code: mine.error?.code ?? hers.error?.code,
      message: mine.error?.message ?? hers.error?.message,
    });
    return out;
  }

  const now = Date.now();
  const ensure = (w: string) => {
    let e = out.get(w);
    if (!e) {
      e = { theirs: { ...EMPTY_TALLY }, yours: { ...EMPTY_TALLY } };
      out.set(w, e);
    }
    return e;
  };
  for (const r of (mine.data ?? []) as CallRow[]) {
    const e = ensure(String(r.responder_wallet).toLowerCase());
    const t = tally([factOf(r)], now);
    e.theirs.answered += t.answered;
    e.theirs.waiting += t.waiting;
    e.theirs.outOfReach += t.outOfReach;
  }
  for (const r of (hers.data ?? []) as CallRow[]) {
    const e = ensure(String(r.caller_wallet).toLowerCase());
    const t = tally([factOf(r)], now);
    e.yours.answered += t.answered;
    e.yours.waiting += t.waiting;
    e.yours.outOfReach += t.outOfReach;
  }
  return out;
}

/**
 * SOMEBODY SHOWED UP — recent answers to this viewer's calls, ONE ROW PER MARKET.
 *
 * The aggregation is the feature. Three people answering in the same market is
 * one thing that happened to you; three rows would be a notification inbox in the
 * tape's clothing, getting loudest on the reader's best day and saying nothing new
 * by the third line.
 *
 * Read from the ledger rather than from `events` because the causal claim is the
 * point: not "somebody traded in a market I am also in", which on a platform this
 * size is ordinary coincidence, but "my conviction created a call for them and
 * they answered it".
 */
export interface ShowedUp {
  marketId: number;
  title: string;
  people: NamedPerson[];
  /** The most recent answer in this market — what the row is dated by. */
  atMs: number;
}

export async function showedUpForMe(viewer: string, sinceMs: number): Promise<ShowedUp[]> {
  const me = viewer.toLowerCase();
  if (!me) return [];
  const sb = serviceClient();
  const { data, error } = await sb
    .from("market_calls")
    .select("market_id, responder_wallet, responded_at")
    .eq("caller_wallet", me)
    .not("responded_at", "is", null)
    .gte("responded_at", new Date(sinceMs).toISOString())
    .order("responded_at", { ascending: false })
    .limit(READ.pairCalls);
  if (error) {
    // Loudly, then degrade — the tape keeps working without this family rather
    // than the whole read failing over a social row.
    console.error("[challenge] showed-up rows unreadable", {
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

  const byMarket = new Map<number, { wallets: string[]; atMs: number }>();
  for (const r of rows) {
    const id = Number(r.market_id);
    const at = Date.parse(r.responded_at);
    if (!Number.isFinite(id) || !Number.isFinite(at)) continue;
    const cur = byMarket.get(id) ?? { wallets: [], atMs: 0 };
    const w = String(r.responder_wallet).toLowerCase();
    if (!cur.wallets.includes(w)) cur.wallets.push(w);
    cur.atMs = Math.max(cur.atMs, at);
    byMarket.set(id, cur);
  }

  const { resolveProfiles } = await import("@/lib/profiles.server");
  const [titleOf, profiles] = await Promise.all([
    titlesFor(sb, [...byMarket.keys()]),
    resolveProfiles([...new Set(rows.map((r) => String(r.responder_wallet).toLowerCase()))], 0),
  ]);

  const out: ShowedUp[] = [];
  for (const [marketId, v] of byMarket) {
    const title = titleOf.get(marketId);
    if (!title) continue;
    out.push({
      marketId,
      title,
      people: v.wallets.map((w) => ({
        wallet: w,
        name: profiles.get(w)?.displayName?.trim() || aliasFor(w),
      })),
      atMs: v.atMs,
    });
  }
  return out.sort((a, b) => b.atMs - a.atMs || a.marketId - b.marketId);
}

/** Titles for a set of markets, dropping the ones that do not resolve. */
async function titlesFor(sb: Sb, ids: readonly number[]): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const { data } = await sb.from("markets").select("onchain_id, title").in("onchain_id", ids);
  return new Map(
    ((data ?? []) as { onchain_id: number; title: string | null }[])
      .filter((m) => m.title)
      .map((m) => [Number(m.onchain_id), String(m.title)]),
  );
}
