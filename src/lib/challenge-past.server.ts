/**
 * PAST CHALLENGES — reading the record of what my questions did.
 *
 * WHAT THIS READS, AND WHY IT IS ITS OWN FILE. The rail's living cards
 * (`challenge-card.server`) answer "what is happening to me right now" and pay for
 * it — a per-card relay-audience probe, a 60-market bound, the whole state
 * machine. History asks a different, cheaper question: "what became of the
 * questions I put up?" It needs no audience probe and no live state, just the
 * frozen outcome of each Challenge — so it gets its own reader rather than
 * deforming the card path to serve two masters, exactly as `challenge-card.server`
 * was split from `challenge.server` for the same reason.
 *
 * IT IS THE SENT DIRECTION, BY DESIGN. The page answers "what happened with the
 * challenges I MADE", so its spine is the `challenges` rows I authored and the
 * recipient calls underneath them. The reciprocal — questions I answered for
 * other people — rides along as a compact list so the history stays complete,
 * but it is never what the summary counts.
 *
 * REAL LEDGER ONLY. A Simulation Challenge is practice; the durable record of
 * convictions I put in front of real people is REAL, and mixing a rehearsal into
 * it would misstate both. The rail is already mode-scoped for the same reason.
 *
 * EVERY READ IS BOUNDED, like all `market_calls`/`challenges` access here. Nothing
 * may become a graph traversal, and when a bound is hit the payload says so rather
 * than presenting a truncated record as the whole story.
 */
import { serviceClient } from "@/lib/supabase-clients";
import { aliasFor } from "@/lib/wallet-identity";
import { audienceGroupFor, callRelationAtTime } from "@/domain/audience";
import { buildPastChallenge, type PastChallenge, type PastResponder, type ShowedUpEntry } from "@/domain/challenge-past";
import type { Side } from "@/domain/post-action";

export type Sb = ReturnType<typeof serviceClient>;

/** Bounds. A history reader is not a feed builder. */
const READ = {
  /** Challenge events read for one author. The number that decides `truncated`. */
  challenges: 300,
  /** Recipient calls read across those challenges. Generous — a denominator lies
   *  if it is silently clipped — but bounded like everything else in this file. */
  calls: 5000,
  /** Answered-elsewhere rows for the compact reciprocal list. */
  answered: 300,
} as const;

const sideOf = (v: unknown): Side | null => (v === "YES" || v === "NO" ? v : null);

interface ChallengeRow {
  id: number;
  market_id: number;
  created_at: string;
  closed_at: string | null;
  close_reason: string | null;
}

interface CallRow {
  challenge_id: number | null;
  market_id: number;
  responder_wallet: string;
  responded_at: string | null;
  responded_side: string | null;
  passed_at: string | null;
  relation_at_call: string;
}

export interface ChallengePast {
  /** One story per Challenge I put up, newest activity first. Past only. */
  items: PastChallenge[];
  /** The reciprocal: questions I answered for others. Compact, newest first. */
  showedUp: ShowedUpEntry[];
  /** True when a read hit its bound and older events exist behind it. */
  truncated: boolean;
}

const EMPTY: ChallengePast = { items: [], showedUp: [], truncated: false };

export async function challengePastFor(viewer: string): Promise<ChallengePast> {
  const me = viewer.toLowerCase();
  if (!me) return EMPTY;
  const sb = serviceClient();

  // The events I authored, and the questions I answered for others — read
  // together, because a failed read of either must degrade loudly rather than
  // render as an empty history for somebody with a year of them.
  const [mine, answered] = await Promise.all([
    sb
      .from("challenges")
      .select("id, market_id, created_at, closed_at, close_reason")
      .eq("challenger_wallet", me)
      .eq("mode", "REAL")
      .order("created_at", { ascending: false })
      .limit(READ.challenges),
    sb
      .from("market_calls")
      .select("market_id, caller_wallet, called_at, responded_at")
      .eq("responder_wallet", me)
      .eq("mode", "REAL")
      .not("responded_at", "is", null)
      .order("responded_at", { ascending: false })
      .limit(READ.answered),
  ]);

  if (mine.error) {
    console.error("[past] challenges unreadable", {
      code: mine.error.code,
      message: mine.error.message,
    });
    throw new Error(mine.error.message);
  }
  // The reciprocal list is a courtesy, not the spine — a blocked read there
  // degrades to no list rather than failing the whole page.
  if (answered.error) {
    console.error("[past] answered-elsewhere unreadable", {
      code: answered.error.code,
      message: answered.error.message,
    });
  }

  const challenges = (mine.data ?? []) as ChallengeRow[];
  const answeredRows = (answered.data ?? []) as {
    market_id: number;
    caller_wallet: string;
    called_at: string;
    responded_at: string;
  }[];
  if (challenges.length === 0 && answeredRows.length === 0) return EMPTY;

  const challengeIds = challenges.map((c) => Number(c.id));
  // The recipient calls underneath my challenges — the outcome of each event.
  let callRows: CallRow[] = [];
  if (challengeIds.length) {
    const { data, error } = await sb
      .from("market_calls")
      .select(
        "challenge_id, market_id, responder_wallet, responded_at, responded_side, passed_at, relation_at_call",
      )
      .in("challenge_id", challengeIds)
      .eq("mode", "REAL")
      .limit(READ.calls);
    if (error) {
      console.error("[past] recipient calls unreadable", { code: error.code, message: error.message });
      throw new Error(error.message);
    }
    callRows = (data ?? []) as CallRow[];
  }

  // Everyone this page names, resolved once, after membership is settled.
  const marketIds = [
    ...new Set([
      ...challenges.map((c) => Number(c.market_id)),
      ...answeredRows.map((r) => Number(r.market_id)),
    ]),
  ];
  const responderWallets = new Set<string>();
  for (const r of callRows)
    if (r.responded_at) responderWallets.add(String(r.responder_wallet).toLowerCase());
  const callerWallets = new Set(answeredRows.map((r) => String(r.caller_wallet).toLowerCase()));

  const { resolveProfiles } = await import("@/lib/profiles.server");
  const [titleOf, myStance, profiles] = await Promise.all([
    titlesFor(sb, marketIds),
    // WHAT I BACKED — the belief each Challenge was a test of. Read the same way
    // `buildChallenges` reads a caller's side: the canonical current stance.
    myStanceIn(sb, me, challenges.map((c) => Number(c.market_id))),
    resolveProfiles([...responderWallets, ...callerWallets], 0),
  ]);
  const nameOf = (w: string) => profiles.get(w)?.displayName?.trim() || aliasFor(w);

  /* ── The events I authored, grouped by challenge and reduced to their outcome ── */
  const byChallenge = new Map<number, CallRow[]>();
  for (const r of callRows) {
    const id = Number(r.challenge_id);
    if (!Number.isFinite(id)) continue;
    const list = byChallenge.get(id);
    if (list) list.push(r);
    else byChallenge.set(id, [r]);
  }

  const items: PastChallenge[] = [];
  for (const ch of challenges) {
    const marketId = Number(ch.market_id);
    const title = titleOf.get(marketId);
    if (!title) continue;

    const recipients = byChallenge.get(Number(ch.id)) ?? [];
    let passed = 0;
    let waiting = 0;
    let lastAnswerMs = 0;
    const responders: PastResponder[] = [];
    for (const r of recipients) {
      const respondedMs = r.responded_at ? Date.parse(r.responded_at) : null;
      const passedMs = r.passed_at ? Date.parse(r.passed_at) : null;
      // Taking a side outranks a pass, exactly as `recipientState` decides it.
      if (respondedMs != null) {
        const relation = callRelationAtTime(r.relation_at_call);
        responders.push({
          wallet: String(r.responder_wallet).toLowerCase(),
          name: nameOf(String(r.responder_wallet).toLowerCase()),
          avatarUrl: profiles.get(String(r.responder_wallet).toLowerCase())?.pfpUrl ?? null,
          side: sideOf(r.responded_side),
          // A row whose frozen relation cannot be parsed is Still Forming rather
          // than dropped — it happened, and the reader is owed the answer.
          group: relation ? audienceGroupFor(relation) : "forming",
        });
        if (respondedMs > lastAnswerMs) lastAnswerMs = respondedMs;
      } else if (passedMs != null) passed += 1;
      else waiting += 1;
    }

    const closedAtMs = ch.closed_at ? Date.parse(ch.closed_at) : null;
    const createdMs = Date.parse(ch.created_at);
    const reached = recipients.length;

    /**
     * PAST ONLY — the same boundary the panel reads, from the other side.
     *
     * A Challenge still gathering answers (nobody accounted-for is missing and it
     * is not closed) is CURRENT: it belongs on the rail, and putting it here too
     * would make the reader monitor it in two places. So an OPEN challenge with
     * people still out is skipped; a closed one, or one where everyone has
     * answered or passed, is history.
     */
    const stillLive = closedAtMs == null && reached > 0 && waiting > 0;
    if (stillLive) continue;

    items.push(
      buildPastChallenge({
        marketId,
        title,
        yourSide: myStance.get(marketId) ?? null,
        // When it last had life: the newest answer, else when I put it up.
        atMs: lastAnswerMs || closedAtMs || createdMs,
        closedAtMs,
        closeReason: ch.close_reason === "creator" || ch.close_reason === "all_responded" ? ch.close_reason : null,
        reached,
        passed,
        responders,
      }),
    );
  }
  items.sort((a, b) => b.atMs - a.atMs || a.marketId - b.marketId);

  /* ── The reciprocal: questions I answered, one line each, deduped by market ── */
  const showedUpByMarket = new Map<number, ShowedUpEntry>();
  // Rows arrive newest-answer first; keep the earliest CALLER per market as the
  // one who brought me in, and the newest answer time as when I showed up.
  for (const r of [...answeredRows].sort((a, b) => Date.parse(a.called_at) - Date.parse(b.called_at))) {
    const marketId = Number(r.market_id);
    const title = titleOf.get(marketId);
    if (!title) continue;
    const wallet = String(r.caller_wallet).toLowerCase();
    if (wallet === me) continue;
    const at = Date.parse(r.responded_at);
    const existing = showedUpByMarket.get(marketId);
    if (existing) {
      // Same market, a later answer — advance the timestamp, keep the first caller.
      if (at > existing.atMs) existing.atMs = at;
    } else {
      showedUpByMarket.set(marketId, { marketId, title, who: nameOf(wallet), wallet, atMs: at });
    }
  }
  const showedUp = [...showedUpByMarket.values()].sort(
    (a, b) => b.atMs - a.atMs || a.marketId - b.marketId,
  );

  return {
    items,
    showedUp,
    // Said out loud rather than pretended away: a bounded read presented as the
    // whole record is the worst possible lie on a surface promising completeness.
    truncated: challenges.length >= READ.challenges || callRows.length >= READ.calls,
  };
}

/** What I currently hold in each of my own markets. YES/NO only; MIXED is no side. */
async function myStanceIn(
  sb: Sb,
  me: string,
  marketIds: readonly number[],
): Promise<Map<number, Side>> {
  const ids = [...new Set(marketIds.filter((n) => Number.isFinite(n)))];
  const out = new Map<number, Side>();
  if (ids.length === 0) return out;
  const { data, error } = await sb
    .from("wallet_beliefs")
    .select("onchain_id, stance_side")
    .eq("wallet", me)
    .in("onchain_id", ids)
    .in("stance_side", ["YES", "NO"]);
  if (error) {
    // A missing stance is not a wrong one — the card simply omits "your call".
    console.warn("[past] own stance unreadable", { code: error.code });
    return out;
  }
  for (const r of (data ?? []) as { onchain_id: number; stance_side: string }[]) {
    const side = sideOf(r.stance_side);
    if (side) out.set(Number(r.onchain_id), side);
  }
  return out;
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
