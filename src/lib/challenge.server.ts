/**
 * CHALLENGE — reading the calls people deliberately made.
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
  CALLER_RELATIONS,
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
  /**
   * Open calls read for one reader.
   *
   * Generous on purpose — it is the READ bound, not the display bound. The rail
   * shows a railful and says how many more are behind it, which it can only do
   * honestly if it has actually seen them.
   */
  openCalls: 200,
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
export interface Caller {
  relation: CallerRelation;
  together: number | null;
  shared: number | null;
}

export type Sb = ReturnType<typeof serviceClient>;

/**
 * The viewer's qualified callers, by canonical relationship.
 *
 * ORDER MATTERS ON COLLISION. A wallet in more than one bucket keeps the
 * strongest claim, and the buckets are read strongest-first so the first write
 * wins — the same precedence the domain module applies when ranking.
 */
export async function qualifiedCallers(sb: Sb, viewer: string): Promise<Map<string, Caller>> {
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
 * OPEN CHALLENGES for one viewer.
 *
 * Returns `[]` for a viewer with no qualified callers, which today is most of
 * them — 95% of wallets have no Tribe and no wallet has a Rival. An empty panel
 * is the correct state, not a failure, and nothing here manufactures a caller to
 * avoid it.
 */
/**
 * WHO WANTS YOU AT THE TABLE — read, not inferred.
 *
 * THIS USED TO GUESS. It scanned every qualified person's recent trades, found
 * markets the viewer had not answered, and manufactured a "call" from the
 * coincidence. Nobody had chosen anything, which is exactly why "Sarah wants you
 * at the table" was a sentence the data could not support: Sarah had traded, and
 * the system had decided that meant she wanted something from you.
 *
 * Now a call exists only because somebody put a question on the table. The rows
 * were written once, at that moment, with the relationship frozen as it was — so
 * this is a read of deliberate acts rather than a derivation from ambient ones.
 * Roughly a hundred lines of inference are gone with it: the event scan, the
 * window, the caller-event cap, the one-caller-per-market reduction and the
 * fire-and-forget write that made surfacing itself the call.
 *
 * The card can now say who wants you there, and mean it.
 */
export async function buildChallenges(viewer: string): Promise<Challenge[]> {
  const me = viewer.toLowerCase();
  const sb = serviceClient();

  // Open calls addressed to this reader, newest first. Answered and passed rows
  // are already terminal and belong to nobody's action queue.
  const { data: rows, error } = await sb
    .from("market_calls")
    .select("market_id, caller_wallet, relation_at_call, called_at")
    .eq("responder_wallet", me)
    .not("challenge_id", "is", null)
    .is("responded_at", null)
    .is("passed_at", null)
    .order("called_at", { ascending: false })
    .limit(READ.openCalls);
  // Loudly, then degrade. A blocked read must never render as an empty room.
  if (error) {
    console.error("[challenge] open calls unreadable", {
      code: error.code,
      message: error.message,
    });
    throw new Error(error.message);
  }
  const calls = (rows ?? []) as {
    market_id: number;
    caller_wallet: string;
    relation_at_call: string;
    called_at: string;
  }[];
  if (calls.length === 0) return [];

  const marketIds = [...new Set(calls.map((c) => Number(c.market_id)))];
  const wallets = [...new Set(calls.map((c) => String(c.caller_wallet).toLowerCase()))];

  const { resolveProfiles } = await import("@/lib/profiles.server");
  const [{ data: markets }, { data: sides }, profiles, callers] = await Promise.all([
    sb.from("markets").select("onchain_id, title").in("onchain_id", marketIds),
    // WHAT THE CALLER CURRENTLY HOLDS, not whichever event produced them. A
    // caller who has since exited or flipped must not be quoted as believing
    // something they no longer believe.
    sb
      .from("wallet_beliefs")
      .select("wallet, onchain_id, stance_side")
      .in("wallet", wallets)
      .in("onchain_id", marketIds)
      .in("stance_side", ["YES", "NO"]),
    resolveProfiles(wallets, 0),
    qualifiedCallers(sb, me),
  ]);

  const titleOf = new Map(
    ((markets ?? []) as { onchain_id: number; title: string | null }[])
      .filter((m) => m.title)
      .map((m) => [Number(m.onchain_id), String(m.title)]),
  );
  const stanceOf = new Map(
    ((sides ?? []) as { wallet: string; onchain_id: number; stance_side: string }[]).map((r) => [
      `${String(r.wallet).toLowerCase()}|${Number(r.onchain_id)}`,
      r.stance_side === "NO" ? ("NO" as const) : ("YES" as const),
    ]),
  );

  const evidence: CallEvidence[] = [];
  for (const c of calls) {
    const marketId = Number(c.market_id);
    const wallet = String(c.caller_wallet).toLowerCase();
    const title = titleOf.get(marketId);
    if (!title) continue;
    const relation = CALLER_RELATIONS.find((r: CallerRelation) => r === c.relation_at_call);
    if (!relation) continue;
    // The pair's record comes from the LIVE cache, not the frozen row: the
    // relationship AT CALL decides who may call, and today's numbers are what a
    // reader is owed beside a question they are about to answer.
    const pair = callers.get(wallet);
    // A CALLER WHO HAS SINCE EXITED STILL ASKED. Their current stance decides
    // whether the card can say "Sarah believes YES" — but if they have gone
    // MIXED or flat, the Challenge does not vanish, because putting it on the
    // table is the thing they did and it remains true. The sentence falls back to
    // the one that needs no side, rather than the row silently disappearing and
    // taking somebody's deliberate request with it.
    const side = stanceOf.get(`${wallet}|${marketId}`) ?? null;
    evidence.push({
      marketId,
      title,
      caller: {
        wallet,
        name: profiles.get(wallet)?.displayName?.trim() || aliasFor(wallet),
      },
      relation,
      act: side ? "trade" : "market_created",
      callerSide: side,
      together: pair?.together ?? null,
      shared: pair?.shared ?? null,
      atMs: Date.parse(c.called_at),
    });
  }
  return composeChallenges(evidence);
}

/**
 * The responder took a side — close every open call addressed to them here.
 *
 * Only open calls are stamped (`responded_at IS NULL`), so the recorded time is
 * when they FIRST answered. Overwriting it on every later trade would turn
 * "when did they show up" into "when were they last here", which is a different
 * and much less useful fact.
 */
/**
 * DID THIS WALLET ACTUALLY TAKE A POSITION HERE?
 *
 * `answerCalls` is an unsigned POST carrying `{ wallet, marketId }`, and it used
 * to stamp on the client's word alone. That was survivable while Showing Up was a
 * quiet relationship fact. It stops being survivable the moment a creator reads
 * "3 of 8 showed up", because anyone could have made any of those three true with
 * a curl command — and a fabricated one is a permanent claim about a real person.
 *
 * So the server proves the public fact it is being asked to record. Two sources,
 * either sufficient: the canonical current stance, or a canonical directional
 * trade. Neither is the client talking.
 */
async function tookAPosition(sb: Sb, wallet: string, marketId: number): Promise<boolean> {
  const w = wallet.toLowerCase();
  const [{ data: stance }, { data: trade }] = await Promise.all([
    sb
      .from("wallet_beliefs")
      .select("stance_side")
      .eq("wallet", w)
      .eq("onchain_id", marketId)
      .in("stance_side", ["YES", "NO"])
      .maybeSingle(),
    sb
      .from("events")
      .select("id")
      .eq("wallet", w)
      .eq("market_id", String(marketId))
      .eq("kind", "trade")
      .eq("is_canonical", true)
      .limit(1)
      .maybeSingle(),
  ]);
  return !!stance || !!trade;
}

/**
 * @returns the callers this answer closed, and whether it could be proved at all.
 *
 * `pending` is the honest third outcome, and it exists because a bare gate would
 * have broken the feature it protects. This runs the instant a trade confirms in
 * the wallet, which can be BEFORE the indexer has written the event — so refusing
 * outright would reject real answers during exactly the window the product cares
 * about. Pending means "not proved YET": nothing is stamped, nothing is lost, and
 * the next call once the position is visible closes it for real. Idempotent by the
 * `responded_at IS NULL` filter, so retrying costs nothing.
 */
export async function markCallsAnswered(
  wallet: string,
  marketId: number,
): Promise<{ closed: NamedPerson[]; pending: boolean }> {
  const sb = serviceClient();
  if (!(await tookAPosition(sb, wallet, marketId))) {
    // Not a failure and not a forgery — just not visible yet. Said out loud so a
    // persistent gap in the logs is distinguishable from a quiet one.
    console.warn("[challenge] answer not provable yet, nothing stamped", { wallet, marketId });
    return { closed: [], pending: true };
  }
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
    return { closed: [], pending: false };
  }
  const wallets = [
    ...new Set(
      ((data ?? []) as { caller_wallet: string }[]).map((r) =>
        String(r.caller_wallet).toLowerCase(),
      ),
    ),
  ];
  if (wallets.length === 0) return { closed: [], pending: false };
  const { resolveProfiles } = await import("@/lib/profiles.server");
  const profiles = await resolveProfiles(wallets, 0);
  return {
    closed: wallets.map((w) => ({
      wallet: w,
      name: profiles.get(w)?.displayName?.trim() || aliasFor(w),
    })),
    pending: false,
  };
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
