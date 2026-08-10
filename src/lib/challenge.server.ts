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
import { CLOSEST_MIN_SHARED } from "@/domain/dna/config";
import {
  composeChallenges,
  type CallEvidence,
  type CallerRelation,
  type Challenge,
  type ChallengeState,
  type CallReach,
} from "@/domain/challenge";
// The SAME week the creator's finished Challenge stays on their own table, so both
// ends of one interaction go quiet together rather than at two different times.
import { FINISHED_WINDOW_MS } from "@/domain/table";
import {
  EMPTY_TALLY,
  NO_RECIPROCITY,
  reciprocity,
  tally,
  type CallDirection,
  type CallFact,
  type HistoryEntry,
  type PairCall,
  type Reciprocity,
  type Tally,
} from "@/domain/dependability";
import type { NamedPerson } from "@/domain/challenge";
import {
  audienceGroupFor,
  callRelationAtTime,
  dedupeAudience,
  presentAudience,
  toMembers,
  type AudienceCandidate,
  type AudienceFailure,
  type AudienceResult,
  type CallRelationAtTime,
} from "@/domain/audience";

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
  /**
   * Answered calls read per direction when establishing provenance.
   *
   * Generous, because this one is looking for DISTINCT PEOPLE rather than rows:
   * a pair who go back and forth constantly occupy a great many rows between
   * them and are still one member of an audience.
   */
  answeredPairs: 400,
  /**
   * Calls read for the COMPLETE history, per direction.
   *
   * Higher than a pair's, because this spans everybody — and still bounded, like
   * every read in this file. When it is hit the payload says so rather than
   * quietly presenting a truncated list as the whole story, which on a surface
   * whose entire promise is completeness would be the worst possible lie.
   */
  history: 500,
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

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/**
 * THE STRONG BUCKETS PLUS THE TWO THAT MAKE STILL FORMING POSSIBLE.
 *
 * `neutral_matches` and `closest_matches` have been written by the DNA worker
 * since the cache shipped and read by nothing on this path. They are the whole
 * difference between an audience that exists on a cold-start network and one
 * that does not — and reading them is cheaper than the alternative everyone
 * reaches for, which is lowering the bar for what counts as knowing somebody.
 *
 * NEUTRAL AND CLOSEST ARE NOT THE SAME CLAIM, which is why they arrive with
 * different provenance:
 *
 *   NEUTRAL   made the evidence bar (`minSharedOverall`) and landed in no strong
 *             band. The engine LOOKED at this pair and has an answer: no strong
 *             alignment either way. That is a finding, not an absence.
 *   CLOSEST   cleared only `CLOSEST_MIN_SHARED` — at least one shared
 *             directional belief. Real, thin, and honestly labelled
 *             `insufficient`, because the engine did not have enough to band
 *             them and the frozen row must say so.
 *
 * Every closest row is tagged `insufficient` even when it describes a Twin. The
 * pool contains everybody with any overlap, so the strong buckets and this one
 * overlap heavily — and `dedupeAudience` keeps the strongest canonical fact per
 * wallet regardless of which read produced it. Tagging by SOURCE rather than by
 * the row's own `relationship` field is deliberate: a person who reads
 * "neutral" in the closest pool but never made the neutral bucket did not clear
 * the evidence bar, and calling them neutral would claim an answer the engine
 * never reached.
 *
 * FAILS CLOSED. An unreadable cache is not a viewer with no network.
 */
async function dnaCandidates(
  sb: Sb,
  viewer: string,
): Promise<{ status: "ok"; rows: AudienceCandidate[] } | { status: "failed" }> {
  const { data, error } = await sb
    .from("viewer_dna_cache")
    .select(
      "twin_matches, tribe_matches, opp_matches, inverse_matches, neutral_matches, closest_matches",
    )
    .eq("viewer_wallet", viewer)
    .maybeSingle();
  if (error) {
    console.error("[challenge] dna cache unreadable", { code: error.code, message: error.message });
    return { status: "failed" };
  }

  const rows: AudienceCandidate[] = [];
  const take = (
    source: unknown,
    relationAtCall: CallRelationAtTime,
    provenance: AudienceCandidate["provenance"],
    /** Only `closest` applies one: the shared-belief floor below. */
    minShared = 0,
  ) => {
    for (const r of ((source as CachedRelationship[] | null) ?? []).slice(
      0,
      READ.peoplePerBucket,
    )) {
      const w = r?.wallet ? String(r.wallet).toLowerCase() : null;
      if (!w || w === viewer) continue;
      const shared = num(r?.sharedBeliefs);
      /**
       * ZERO SHARED BELIEFS IS NOT A THIN RELATIONSHIP, IT IS NO RELATIONSHIP.
       *
       * The worker already applies `CLOSEST_MIN_SHARED`, so in practice nothing
       * is rejected here. The floor is restated at the point of USE because
       * that is where it would be lost: a cache written by an older engine, a
       * threshold relaxed for some unrelated Network-list reason, and a wallet
       * with no overlap at all quietly becomes a person somebody is told they
       * are connected to.
       */
      if ((shared ?? 0) < minShared) continue;
      rows.push({
        wallet: w,
        relationAtCall,
        provenance,
        sharedBeliefs: shared,
        sameSideBeliefs: num(r?.sameSideBeliefs),
      });
    }
  };
  take(data?.twin_matches, "twin", "strong_dna");
  take(data?.tribe_matches, "tribe", "strong_dna");
  take(data?.inverse_matches, "inverse", "strong_dna");
  take(data?.opp_matches, "opp", "strong_dna");
  take(data?.neutral_matches, "neutral", "neutral_dna");
  take(data?.closest_matches, "insufficient", "closest_match", CLOSEST_MIN_SHARED);
  return { status: "ok", rows };
}

/**
 * PEOPLE THE GRAPH CANNOT SEE, WHO UNMISTAKABLY SHOWED UP FOR EACH OTHER.
 *
 * A Market Maker is the case this exists for. Somebody who puts questions up and
 * never takes a side holds no directional beliefs, so they share none with
 * anybody — every DNA bucket is empty for them forever, in both directions. And
 * yet people have answered their Challenges. Something happened between those
 * two humans that the belief graph is structurally incapable of representing,
 * and refusing to see it would mean the person doing the most to start
 * conversations has the smallest audience on the platform.
 *
 * AN ANSWER IN EITHER DIRECTION COUNTS, and only an answer. `responded_at IS NOT
 * NULL` is the entire test: an unanswered call is one person's hope, a pass is a
 * decline, and a call that was merely surfaced is not a relationship. Somebody
 * who passed does not enter this set — which also means Still Forming can never
 * be populated by asking the same uninterested person again and again.
 *
 * Two indexed reads along `market_calls_caller_idx` and
 * `market_calls_responder_idx`, the same pair every other path in this file
 * uses. `sharedBeliefs` is NULL rather than 0: there is no belief overlap
 * measurement here at all, and writing zero would state one.
 */
async function answeredCandidates(
  sb: Sb,
  viewer: string,
): Promise<{ status: "ok"; rows: AudienceCandidate[] } | { status: "failed" }> {
  const [mine, theirs] = await Promise.all([
    sb
      .from("market_calls")
      .select("responder_wallet")
      .eq("caller_wallet", viewer)
      .not("responded_at", "is", null)
      .limit(READ.answeredPairs),
    sb
      .from("market_calls")
      .select("caller_wallet")
      .eq("responder_wallet", viewer)
      .not("responded_at", "is", null)
      .limit(READ.answeredPairs),
  ]);
  if (mine.error || theirs.error) {
    console.error("[challenge] answered-call provenance unreadable", {
      code: mine.error?.code ?? theirs.error?.code,
      message: mine.error?.message ?? theirs.error?.message,
    });
    return { status: "failed" };
  }

  const wallets = new Set<string>();
  for (const r of (mine.data ?? []) as { responder_wallet: string }[])
    wallets.add(String(r.responder_wallet).toLowerCase());
  for (const r of (theirs.data ?? []) as { caller_wallet: string }[])
    wallets.add(String(r.caller_wallet).toLowerCase());
  wallets.delete(viewer);

  return {
    status: "ok",
    rows: [...wallets].map((wallet) => ({
      wallet,
      relationAtCall: "insufficient" as const,
      provenance: "answered_challenge" as const,
      sharedBeliefs: null,
      sameSideBeliefs: null,
    })),
  };
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

  /**
   * WHAT IS WAITING, PLUS WHAT RECENTLY BECAME OF WHAT WAS.
   *
   * This read used to be `responded_at IS NULL AND passed_at IS NULL` — the queue
   * and nothing else. The reasoning was that a queue with completed items in it is
   * a to-do list, and that is true of a to-do list. It is not true of this: the
   * single thing this whole system exists to produce is somebody revealing where
   * they stand because somebody else asked, and the row was being deleted at the
   * exact instant that became true. The reader learned it from a panel that
   * flashed once after their own trade, or not at all.
   *
   * So a terminal row survives for the SAME week the creator's side already keeps
   * (`FINISHED_WINDOW_MS`), and the two ends of one interaction go quiet together.
   * It is still not a to-do list, because an outcome asks for nothing: no button,
   * no dismiss, no badge — `challengeCount` counts only what is waiting.
   */
  const since = new Date(Date.now() - FINISHED_WINDOW_MS).toISOString();
  const { data: rows, error } = await sb
    .from("market_calls")
    .select("market_id, caller_wallet, relation_at_call, called_at, responded_at, passed_at")
    .eq("responder_wallet", me)
    .not("challenge_id", "is", null)
    .or(
      `and(responded_at.is.null,passed_at.is.null),responded_at.gte.${since},passed_at.gte.${since}`,
    )
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
    responded_at: string | null;
    passed_at: string | null;
  }[];
  if (calls.length === 0) return [];

  const marketIds = [...new Set(calls.map((c) => Number(c.market_id)))];
  const wallets = [...new Set(calls.map((c) => String(c.caller_wallet).toLowerCase()))];

  const { resolveProfiles } = await import("@/lib/profiles.server");
  const [{ data: markets }, { data: sides }, profiles, callers, pairs] = await Promise.all([
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
    /**
     * THE RUN WITH EACH CALLER, from the one function that already computes it.
     *
     * Two queries for the whole railful, not one per card — and, more importantly,
     * the SAME two queries the People cards and the profile read, so "6 back &
     * forth" cannot mean one thing here and another there. Nothing new is stored
     * and nothing is recomputed locally.
     */
    dependabilityFor(me, wallets),
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
    /**
     * PARSED BY THE MODULE THAT OWNS THE STORED VOCABULARY.
     *
     * A row whose label does not parse is skipped, which is right for a value
     * this file cannot interpret — and was catastrophic while the list was four
     * long and the write side had learned six. Every Still Forming call would
     * have been frozen correctly and then dropped on the one screen it was
     * written for. One list, imported, so the two sides cannot drift again.
     */
    const relation = callRelationAtTime(c.relation_at_call);
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
    // TAKING A SIDE OUTRANKS A PASS, exactly as `recipientState` decides it for the
    // creator's side of the same row: waving a card off and then finding the market
    // anyway is a real path, and the side taken is the larger fact.
    const respondedAt = c.responded_at ? Date.parse(c.responded_at) : null;
    const passedAt = c.passed_at ? Date.parse(c.passed_at) : null;
    const calledAt = Date.parse(c.called_at);
    const state: ChallengeState =
      respondedAt != null ? "showed_up" : passedAt != null ? "passed" : "waiting";
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
      atMs: calledAt,
      state,
      stateAtMs: respondedAt ?? passedAt ?? calledAt,
      reciprocity: pairs.get(wallet)?.reciprocity ?? null,
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
async function tookAPosition(
  sb: Sb,
  wallet: string,
  marketId: number,
): Promise<{ proved: boolean; side: "YES" | "NO" | null }> {
  const w = wallet.toLowerCase();
  const [{ data: stance }, { data: trade }] = await Promise.all([
    sb
      .from("wallet_beliefs")
      .select("stance_side")
      .eq("wallet", w)
      .eq("onchain_id", marketId)
      .in("stance_side", ["YES", "NO"])
      .maybeSingle(),
    // `side` joins the select for the chain card. The proof is unchanged — the
    // row's EXISTENCE is what proves the position — but the same read already
    // knows which way it went, and asking again later would be asking a
    // different question: by then they may have sold.
    sb
      .from("events")
      .select("id, side")
      .eq("wallet", w)
      .eq("market_id", String(marketId))
      .eq("kind", "trade")
      .eq("is_canonical", true)
      .in("side", ["YES", "NO"])
      .order("occurred_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  /**
   * THE SIDE AT THIS MOMENT, and the order of preference is the whole point.
   *
   * The canonical stance is what they hold NOW; the earliest directional trade
   * is what they did when they answered. For a first answer these agree, and
   * when they do not — somebody who answered YES in March and flipped in April —
   * the trade is the honest one, because the card is reporting a moment rather
   * than a position. Falling back to the stance covers the case where the
   * indexer has the belief but not yet the event.
   */
  const fromTrade = (trade as { side?: string } | null)?.side;
  const fromStance = (stance as { stance_side?: string } | null)?.stance_side;
  const pick = fromTrade === "YES" || fromTrade === "NO" ? fromTrade : fromStance;
  return {
    proved: !!stance || !!trade,
    side: pick === "YES" || pick === "NO" ? pick : null,
  };
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
): Promise<{ closed: NamedPerson[]; pending: boolean; parentCall: number | null }> {
  const sb = serviceClient();
  const proof = await tookAPosition(sb, wallet, marketId);
  if (!proof.proved) {
    // Not a failure and not a forgery — just not visible yet. Said out loud so a
    // persistent gap in the logs is distinguishable from a quiet one.
    console.warn("[challenge] answer not provable yet, nothing stamped", { wallet, marketId });
    return { closed: [], pending: true, parentCall: null };
  }
  /**
   * THE SIDE IS WRITTEN WITH THE STAMP, ONCE, AND NEVER AGAIN.
   *
   * It rides the SAME update as `responded_at`, guarded by the same
   * `responded_at IS NULL` filter, so the pair can never disagree: a row either
   * has both or neither, and a later trade cannot rewrite the side somebody
   * answered with. Reading it back from their position afterwards would claim
   * they "went NO" in a market they exited last week.
   *
   * It is PRESENTATION CONTEXT AND NOTHING ELSE. `CallFact` — what the
   * dependability ladder consumes — still carries two timestamps and no side,
   * so a Rival who answers every call still reads as somebody who turns up.
   */
  const stamp: Record<string, unknown> = { responded_at: new Date().toISOString() };
  if (proof.side) stamp["responded_side"] = proof.side;

  // `.select()` on the UPDATE returns exactly the rows this call closed — the
  // ones that were still open a moment ago. Reading them separately afterwards
  // would race a second tab and could name somebody this trade did not answer.
  let res = await sb
    .from("market_calls")
    .update(stamp)
    .eq("market_id", marketId)
    .eq("responder_wallet", wallet.toLowerCase())
    .is("responded_at", null)
    .select("id, caller_wallet, called_at");
  /**
   * THE COLUMN MAY NOT BE THERE YET, AND THE STAMP MATTERS MORE THAN THE SIDE.
   *
   * Code ships before a migration is applied. `42703` is "column does not
   * exist" — if the chain migration has not landed, retrying WITHOUT the side
   * records the thing that has always mattered rather than losing an answer to a
   * column that is only there to decorate a card. Once the migration is applied
   * this branch never runs again.
   */
  if (res.error?.code === "42703" && proof.side) {
    console.warn("[challenge] responded_side not present yet — stamping without it");
    res = await sb
      .from("market_calls")
      .update({ responded_at: stamp["responded_at"] as string })
      .eq("market_id", marketId)
      .eq("responder_wallet", wallet.toLowerCase())
      .is("responded_at", null)
      .select("id, caller_wallet, called_at");
  }
  const { data, error } = res;
  if (error) {
    console.error("[challenge] could not stamp answers", {
      code: error.code,
      message: error.message,
    });
    return { closed: [], pending: false, parentCall: null };
  }
  const rows = (data ?? []) as { id?: number | null; caller_wallet: string; called_at?: string }[];
  const wallets = [...new Set(rows.map((r) => String(r.caller_wallet).toLowerCase()))];
  if (wallets.length === 0) return { closed: [], pending: false, parentCall: null };
  /**
   * THE LINK THIS ANSWER HANGS OFF — the EARLIEST call still open for this
   * market, because that is the person who actually brought the reader in. Two
   * people asking the same question does not fork the chain; the first one owns
   * the lineage and the second is simply also waiting.
   */
  const parentCall =
    rows
      .filter((r) => typeof r.id === "number")
      .sort((a, b) => Date.parse(a.called_at ?? "") - Date.parse(b.called_at ?? ""))[0]?.id ?? null;
  const { resolveProfiles } = await import("@/lib/profiles.server");
  const profiles = await resolveProfiles(wallets, 0);
  return {
    closed: wallets.map((w) => ({
      wallet: w,
      name: profiles.get(w)?.displayName?.trim() || aliasFor(w),
    })),
    pending: false,
    parentCall,
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
/**
 * WHO CAN ACTUALLY BE ASKED ABOUT THIS MARKET — the one definition, used twice.
 *
 * MEASURED AGAINST PRODUCTION, THE OLD ONE WAS WRONG BY 32 PEOPLE across 26 of
 * 284 positions: the preview excluded only CURRENT directional holders while the
 * write excluded nobody market-scoped, so the count shown and the audience
 * recorded were two different sets. Preview and send now call this, and there is
 * no second definition to drift from.
 *
 * IT FAILS CLOSED, AND THE FIRST VERSION DID NOT. It kept everybody eligible when
 * an exclusion query errored, reasoning that overstating by one is recoverable.
 * That was wrong in a way the foundation's own rule already names. "Unknown is
 * not zero" cuts BOTH ways:
 *
 *   an INCLUSION read that fails must not become "nobody qualifies";
 *   an EXCLUSION read that fails must not become "everybody is fair game".
 *
 * A failed participant query does not lose one exclusion — it loses ALL of them,
 * and the write would then put a Challenge in front of every person who had
 * already answered the market. So a failed exclusion is a failed AUDIENCE: the
 * preview hides the module, the write refuses, no slot is spent, and nobody
 * receives a call the server could not verify they were owed.
 *
 * THE FOUR EXCLUSIONS, each because asking that person would be nonsense:
 *
 *   THE AUTHOR       they asked the question; being asked back is a loop.
 *   ANY PARTICIPANT  a `wallet_beliefs` row means the position engine has
 *                    processed trades for them here. It survives a full exit,
 *                    which is why row existence is the test rather than a
 *                    directional stance — selling out does not un-answer.
 *   ALREADY ASKED    an existing `market_calls` row from this caller in ANY
 *                    state: open means they hold it, answered and passed mean
 *                    they replied.
 *   THE VIEWER       dropped when the buckets are read.
 */
export async function eligibleAudience(
  sb: Sb,
  viewer: string,
  marketId: number,
): Promise<
  { status: "ok"; members: AudienceCandidate[] } | { status: "failed"; reason: AudienceFailure }
> {
  const me = viewer.toLowerCase();
  /**
   * THE THREE DOORS, READ TOGETHER AND DEDUPED ONCE.
   *
   * Both reads run before either is inspected, because a person can arrive
   * through several of them and the order they come back in must not decide
   * what `relation_at_call` freezes. `dedupeAudience` settles that by
   * precedence, not by arrival.
   */
  const [dna, answered] = await Promise.all([dnaCandidates(sb, me), answeredCandidates(sb, me)]);
  if (dna.status === "failed") return { status: "failed", reason: "dna_unavailable" };
  if (answered.status === "failed") return { status: "failed", reason: "calls_unavailable" };

  const candidates = dedupeAudience([...dna.rows, ...answered.rows]);
  if (candidates.length === 0) return { status: "ok", members: [] };
  const wallets = candidates.map((c) => c.wallet);

  const [participants, asked, market] = await Promise.all([
    sb.from("wallet_beliefs").select("wallet").eq("onchain_id", marketId).in("wallet", wallets),
    sb
      .from("market_calls")
      .select("responder_wallet")
      .eq("market_id", marketId)
      .eq("caller_wallet", me)
      .in("responder_wallet", wallets),
    sb.from("markets").select("author_wallet").eq("onchain_id", marketId).maybeSingle(),
  ]);

  const refuse = (reason: AudienceFailure, e: { code?: string; message?: string }) => {
    console.error(`[challenge] audience refused — ${reason}`, {
      code: e.code,
      message: e.message,
      marketId,
    });
    return { status: "failed" as const, reason };
  };
  if (participants.error) return refuse("participants_unavailable", participants.error);
  if (asked.error) return refuse("calls_unavailable", asked.error);
  if (market.error) return refuse("market_unavailable", market.error);

  const excluded = new Set<string>();
  const drop = (w: unknown) => {
    const k = String(w ?? "").toLowerCase();
    if (k) excluded.add(k);
  };
  for (const r of (participants.data ?? []) as { wallet: string }[]) drop(r.wallet);
  for (const r of (asked.data ?? []) as { responder_wallet: string }[]) drop(r.responder_wallet);
  drop((market.data as { author_wallet?: string } | null)?.author_wallet);
  drop(me);
  return { status: "ok", members: candidates.filter((c) => !excluded.has(c.wallet)) };
}

/**
 * THE AUDIENCE WITH FACES ON IT — what a preview renders before anybody commits.
 *
 * The ONLY place profiles enter this path, and deliberately the last step. By
 * the time `resolveProfiles` is called the membership is already decided and
 * immutable, so a slow lookup, a missing row or a wallet that has never set a
 * name changes what the reader SEES and never who gets asked. `resolveProfiles`
 * falls back to the deterministic alias, so every member has a name.
 *
 * `lazyCap` is 0: this runs on a preview, and a preview must not spend twenty
 * outbound pov.co lookups. Whatever is already cached is what shows.
 */
export async function audienceFor(wallet: string, marketId: number): Promise<AudienceResult> {
  const me = wallet.toLowerCase();
  if (!me || !Number.isFinite(marketId)) return { status: "none" };
  const sb = serviceClient();

  const resolved = await eligibleAudience(sb, me, marketId);
  if (resolved.status === "failed") return { status: "failed", reason: resolved.reason };
  if (resolved.members.length === 0) return { status: "none" };

  const { resolveProfiles } = await import("@/lib/profiles.server");
  const profiles = await resolveProfiles(
    resolved.members.map((m) => m.wallet),
    0,
  );
  return presentAudience(
    toMembers(resolved.members, (w) => ({
      displayName: profiles.get(w)?.displayName?.trim() || aliasFor(w),
      avatarUrl: profiles.get(w)?.pfpUrl ?? null,
    })),
  );
}

export async function callReachFor(wallet: string, marketId?: number): Promise<CallReach> {
  const sb = serviceClient();
  const me = wallet.toLowerCase();
  /**
   * UNSCOPED IS A DIFFERENT QUESTION. With no market this asks "how many people
   * could my conviction reach at all" — the line shown before a question exists
   * — and there is nothing to exclude against. Scoped, it must agree with what
   * `putOnTable` will actually write, which is what `eligibleAudience` is for.
   */
  let relations: CallRelationAtTime[];
  if (typeof marketId === "number" && Number.isFinite(marketId)) {
    const res = await eligibleAudience(sb, me, marketId);
    // A refused audience is not a reach of zero. Zero would render "nobody
    // qualifies" — a confident claim about somebody's network made from a read
    // that never completed.
    if (res.status === "failed") return { tribe: 0, rivals: 0, forming: 0, failed: true };
    relations = res.members.map((m) => m.relationAtCall);
  } else {
    /**
     * THE SAME THREE DOORS, MINUS THE EXCLUSIONS THERE IS NOTHING TO APPLY YET.
     *
     * It would have been less code to leave this reading the strong buckets
     * alone — and it would have made the unscoped line quietly SMALLER than the
     * scoped one for the same viewer, which reads as "asking about a specific
     * market reaches more people than asking in general". That is nonsense, and
     * it is the same class of drift as the 32-person gap: two definitions of who
     * can be reached.
     */
    const [dna, answered] = await Promise.all([dnaCandidates(sb, me), answeredCandidates(sb, me)]);
    if (dna.status === "failed" || answered.status === "failed")
      return { tribe: 0, rivals: 0, forming: 0, failed: true };
    relations = dedupeAudience([...dna.rows, ...answered.rows]).map((c) => c.relationAtCall);
  }

  /**
   * COUNTED BY THE SAME FUNCTION THAT RENDERS THE HEADINGS.
   *
   * Two places deciding what "Tribe" means is how the preview and the write came
   * to disagree by 32 people the first time. `audienceGroupFor` is exhaustive
   * over the six relations, so a seventh cannot be silently miscounted here.
   */
  let tribe = 0;
  let rivals = 0;
  let forming = 0;
  for (const relation of relations) {
    const group = audienceGroupFor(relation);
    if (group === "tribe") tribe += 1;
    else if (group === "rivals") rivals += 1;
    else forming += 1;
  }
  return { tribe, rivals, forming };
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
  /** The run between the two of you. Derived, never stored — see the domain. */
  reciprocity: Reciprocity;
}

const EMPTY_PAIR: PairCalls = {
  theirs: { ...EMPTY_TALLY },
  yours: { ...EMPTY_TALLY },
  history: [],
  reciprocity: { ...NO_RECIPROCITY },
};

interface CallRow {
  market_id: number;
  caller_wallet: string;
  responder_wallet: string;
  called_at: string;
  responded_at: string | null;
  passed_at: string | null;
}

/**
 * `passed_at` joined the read when the reciprocity run did.
 *
 * IT CHANGES NOTHING ABOUT THE TALLY, and that is deliberate: `factOf` still
 * produces a `CallFact` of two timestamps, so a pass remains invisible to
 * Showing Up, to Conviction Match and to every rung on the ladder. It is read
 * for exactly one purpose — a run ends when somebody chooses to end it — and
 * `pairCallOf` is the only thing that can see it.
 */
const CALL_COLUMNS =
  "market_id, caller_wallet, responder_wallet, called_at, responded_at, passed_at";

const factOf = (r: CallRow): CallFact => ({
  calledAtMs: Date.parse(r.called_at),
  respondedAtMs: r.responded_at ? Date.parse(r.responded_at) : null,
});

/** The same row, plus the two things a run needs and a tally must never see. */
const pairCallOf = (r: CallRow, fromViewer: boolean): PairCall => ({
  ...factOf(r),
  fromViewer,
  passedAtMs: r.passed_at ? Date.parse(r.passed_at) : null,
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

  return {
    theirs,
    yours,
    history,
    // ONE MERGED SEQUENCE, BOTH DIRECTIONS. A run is a property of the pair, not
    // of either person's record of the other, so the two reads are interleaved by
    // `called_at` inside the domain rather than counted separately here.
    reciprocity: reciprocity([
      ...mineRows.map((r) => pairCallOf(r, true)),
      ...hersRows.map((r) => pairCallOf(r, false)),
    ]),
  };
}

/**
 * The same counts for many people at once — what the People cards read.
 *
 * Two queries total regardless of how many people are on screen, because a
 * per-person round trip would put the rail's render cost on the network.
 */
export interface PairSummary {
  theirs: Tally;
  yours: Tally;
  /**
   * The run, computed from the SAME two reads the tallies come from.
   *
   * A separate per-pair query would have been a round trip each for a railful of
   * cards, and — worse — a second place where "do we go back and forth" is
   * decided. One read, one answer, however many people are on screen.
   */
  reciprocity: Reciprocity;
}

export async function dependabilityFor(
  viewer: string,
  wallets: readonly string[],
): Promise<Map<string, PairSummary>> {
  const me = viewer.toLowerCase();
  const them = [...new Set(wallets.map((w) => w.toLowerCase()).filter((w) => w && w !== me))];
  const out = new Map<string, PairSummary>();
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
      e = { theirs: { ...EMPTY_TALLY }, yours: { ...EMPTY_TALLY }, reciprocity: NO_RECIPROCITY };
      out.set(w, e);
    }
    return e;
  };
  // Both directions collected per person first, because a run is a property of
  // the merged sequence and cannot be accumulated one row at a time the way a
  // tally can.
  const sequences = new Map<string, PairCall[]>();
  const push = (w: string, c: PairCall) => {
    const list = sequences.get(w);
    if (list) list.push(c);
    else sequences.set(w, [c]);
  };

  for (const r of (mine.data ?? []) as CallRow[]) {
    const w = String(r.responder_wallet).toLowerCase();
    const e = ensure(w);
    const t = tally([factOf(r)], now);
    e.theirs.answered += t.answered;
    e.theirs.waiting += t.waiting;
    e.theirs.outOfReach += t.outOfReach;
    push(w, pairCallOf(r, true));
  }
  for (const r of (hers.data ?? []) as CallRow[]) {
    const w = String(r.caller_wallet).toLowerCase();
    const e = ensure(w);
    const t = tally([factOf(r)], now);
    e.yours.answered += t.answered;
    e.yours.waiting += t.waiting;
    e.yours.outOfReach += t.outOfReach;
    push(w, pairCallOf(r, false));
  }
  for (const [w, calls] of sequences) ensure(w).reciprocity = reciprocity(calls);
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

/* ── The complete history ─────────────────────────────────────────────────── */

/**
 * EVERY CHALLENGE, BOTH DIRECTIONS, WITH NO SEVEN-DAY WINDOW.
 *
 * WHAT THIS IS NOT, AND THE DISTINCTION IS THE WHOLE DESIGN. The rail answers
 * "who is waiting on me, and what just happened" — it is short on purpose and it
 * goes quiet on purpose. This answers "what have the two of us actually done",
 * for every one of us, forever, and it is reached only by pressing "See all".
 * `FINISHED_WINDOW_MS` is right for a rail and wrong for a history: a week is how
 * long an outcome deserves to be IN THE WAY, not how long it is worth keeping.
 *
 * IT IS NOT A FEED, EITHER. No scoring, no ranking, no admission rule, no
 * significance — chronological, and that is the whole ordering. Anything that
 * decided what was interesting here would be the Insider tape with a different
 * name on it, and Insider already exists one tab across.
 *
 * IT REUSES THE ONE LEDGER. Two reads of `market_calls` along the two indexes that
 * already exist (`market_calls_caller_idx`, `market_calls_responder_idx`), the same
 * `titlesFor` and `resolveProfiles` every other path here uses, and the same
 * `historyRows` vocabulary the profile's "Between you" section renders. No new
 * table, no new query shape, no second history.
 */
export interface ChallengeHistory {
  entries: HistoryEntry[];
  /** Wallet by display name, so a row can open the person it names. */
  people: Record<string, string>;
  /** True when the read hit its bound and older rows exist behind it. */
  truncated: boolean;
}

const EMPTY_HISTORY: ChallengeHistory = { entries: [], people: {}, truncated: false };

export async function challengeHistory(viewer: string): Promise<ChallengeHistory> {
  const me = viewer.toLowerCase();
  if (!me) return EMPTY_HISTORY;
  const sb = serviceClient();

  const [mine, theirs] = await Promise.all([
    sb
      .from("market_calls")
      .select(CALL_COLUMNS)
      .eq("caller_wallet", me)
      .order("called_at", { ascending: false })
      .limit(READ.history),
    sb
      .from("market_calls")
      .select(CALL_COLUMNS)
      .eq("responder_wallet", me)
      .order("called_at", { ascending: false })
      .limit(READ.history),
  ]);

  // Loudly, then degrade — and NEVER as an empty history, which would tell
  // somebody with a year of relationships that they have never challenged anybody.
  for (const [label, res] of [["issued", mine] as const, ["received", theirs] as const]) {
    if (res.error) {
      console.error(`[challenge] history unreadable (${label})`, {
        code: res.error.code,
        message: res.error.message,
      });
      throw new Error(res.error.message);
    }
  }

  const mineRows = (mine.data ?? []) as CallRow[];
  const theirRows = (theirs.data ?? []) as CallRow[];
  if (mineRows.length === 0 && theirRows.length === 0) return EMPTY_HISTORY;

  const ids = [...new Set([...mineRows, ...theirRows].map((r) => Number(r.market_id)))];
  const wallets = [
    ...new Set([
      ...mineRows.map((r) => String(r.responder_wallet).toLowerCase()),
      ...theirRows.map((r) => String(r.caller_wallet).toLowerCase()),
    ]),
  ];
  const { resolveProfiles } = await import("@/lib/profiles.server");
  const [titleOf, profiles] = await Promise.all([titlesFor(sb, ids), resolveProfiles(wallets, 0)]);
  const nameOf = (w: string) => profiles.get(w)?.displayName?.trim() || aliasFor(w);

  const entries: HistoryEntry[] = [];
  const people: Record<string, string> = {};
  const add = (r: CallRow, other: string, direction: CallDirection, atMs: number) => {
    const title = titleOf.get(Number(r.market_id));
    if (!title) return;
    const who = nameOf(other);
    people[who] = other;
    entries.push({ marketId: Number(r.market_id), title, direction, atMs, who });
  };

  for (const r of mineRows) {
    const other = String(r.responder_wallet).toLowerCase();
    // A PASS BY SOMEBODY ELSE IS NOT IN MY HISTORY. The creator of a Challenge is
    // told a count and never a name, and a chronological row saying "Alex passed
    // on you" is that rule quietly reversed. The row is skipped, not softened.
    if (r.passed_at && !r.responded_at) continue;
    if (r.responded_at) add(r, other, "they_answered", Date.parse(r.responded_at));
    else add(r, other, "waiting_on_them", Date.parse(r.called_at));
  }
  for (const r of theirRows) {
    const other = String(r.caller_wallet).toLowerCase();
    // Taking a side outranks a pass, exactly as it does everywhere else.
    if (r.responded_at) add(r, other, "you_answered", Date.parse(r.responded_at));
    else if (r.passed_at) add(r, other, "you_passed", Date.parse(r.passed_at));
    else add(r, other, "waiting_on_you", Date.parse(r.called_at));
  }

  return {
    entries,
    people,
    // SAID OUT LOUD RATHER THAN PRETENDED AWAY. Every read in this file is bounded;
    // a history that silently stopped at the bound would be claiming completeness
    // it does not have, on the one surface whose entire promise is completeness.
    truncated: mineRows.length >= READ.history || theirRows.length >= READ.history,
  };
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

/* ── Provenance: how a question reached you, and where it went next ───────── */

export interface ChainContext {
  startedBy: string | null;
  through: string | null;
  relayedBy: string[];
  relayTables: number;
}

/**
 * WHERE THIS CAME FROM AND WHERE IT WENT — read once for the whole rail.
 *
 * Walking `challenges.parent_call → market_calls.id → that call's challenge` is
 * the entire lineage model. There is no chain table and no denormalised path
 * string: a pointer per link, walked at read time over the handful of markets a
 * rail is showing, is cheaper than a second ledger that can disagree with the
 * first one.
 *
 * NOBODY WHO PASSED IS REACHABLE FROM HERE. Every name this returns either put a
 * question up (a `challenges` row) or was the caller on a call — both public,
 * deliberate acts. A pass writes `passed_at` and never becomes a link.
 */
export async function chainContextFor(
  viewer: string,
  marketIds: number[],
): Promise<Record<number, ChainContext>> {
  const ids = [...new Set(marketIds.filter((n) => Number.isFinite(n)))];
  if (ids.length === 0 || !viewer) return {};
  const me = viewer.toLowerCase();
  const sb = serviceClient();

  const [ch, cl] = await Promise.all([
    sb
      .from("challenges")
      .select("id, market_id, challenger_wallet, parent_call")
      .in("market_id", ids),
    sb
      .from("market_calls")
      .select("id, market_id, caller_wallet, responder_wallet, called_at, challenge_id")
      .in("market_id", ids),
  ]);
  // A missing lineage column is not an error worth failing a rail over — the
  // cards simply render without their provenance line.
  if (ch.error || cl.error) {
    console.warn("[challenge] chain context unavailable", {
      code: ch.error?.code ?? cl.error?.code,
    });
    return {};
  }

  type Ch = {
    id: number;
    market_id: number;
    challenger_wallet: string;
    parent_call: number | null;
  };
  type Cl = {
    id: number | null;
    market_id: number;
    caller_wallet: string;
    responder_wallet: string;
    called_at: string;
    challenge_id: number | null;
  };
  const challenges = (ch.data ?? []) as Ch[];
  const calls = (cl.data ?? []) as Cl[];
  const challengeById = new Map<number, Ch>(challenges.map((c) => [Number(c.id), c]));
  const callById = new Map<number, Cl>(
    calls.filter((c) => c.id != null).map((c) => [Number(c.id), c]),
  );

  const out: Record<number, ChainContext> = {};
  const wanted = new Set<string>();

  for (const marketId of ids) {
    const mine = calls
      .filter((c) => Number(c.market_id) === marketId && c.responder_wallet?.toLowerCase() === me)
      .sort((a, b) => Date.parse(a.called_at) - Date.parse(b.called_at));
    const first = mine[0] ?? null;
    const through = first ? String(first.caller_wallet).toLowerCase() : null;

    // WALK UP. Bounded, because a cycle written by a bug must not hang a read.
    let startedBy: string | null = null;
    let cursor = first?.challenge_id != null ? challengeById.get(Number(first.challenge_id)) : null;
    for (let hop = 0; hop < 8 && cursor; hop++) {
      startedBy = String(cursor.challenger_wallet).toLowerCase();
      const parent = cursor.parent_call != null ? callById.get(Number(cursor.parent_call)) : null;
      const next =
        parent?.challenge_id != null ? challengeById.get(Number(parent.challenge_id)) : null;
      if (!next || next.id === cursor.id) break;
      cursor = next;
    }

    // WHO CARRIED IT PAST ME — relays hanging off a call I made in this market.
    const myCallIds = new Set(
      calls
        .filter((c) => Number(c.market_id) === marketId && c.caller_wallet?.toLowerCase() === me)
        .map((c) => Number(c.id)),
    );
    const children = challenges.filter(
      (c) =>
        Number(c.market_id) === marketId &&
        c.parent_call != null &&
        myCallIds.has(Number(c.parent_call)),
    );
    const relayedBy = [...new Set(children.map((c) => String(c.challenger_wallet).toLowerCase()))];

    out[marketId] = {
      startedBy: startedBy && startedBy !== me ? startedBy : null,
      through: through && through !== me ? through : null,
      relayedBy,
      relayTables: children.length,
    };
    for (const w of [out[marketId].startedBy, out[marketId].through, ...relayedBy])
      if (w) wanted.add(w);
  }

  if (wanted.size === 0) return out;
  const { resolveProfiles } = await import("@/lib/profiles.server");
  const profiles = await resolveProfiles([...wanted], 0);
  const name = (w: string | null) =>
    w ? profiles.get(w)?.displayName?.trim() || aliasFor(w) : null;
  for (const key of Object.keys(out)) {
    const c = out[Number(key)];
    if (!c) continue;
    out[Number(key)] = {
      startedBy: name(c.startedBy),
      through: name(c.through),
      relayedBy: c.relayedBy.map((w) => name(w) ?? "").filter(Boolean),
      relayTables: c.relayTables,
    };
  }
  return out;
}
