/**
 * ONE PROJECTION PER (VIEWER, MARKET) — the only reader the card has.
 *
 * WHAT THIS REPLACES IS A SHAPE, NOT A FUNCTION. Incoming calls were read by
 * `buildChallenges` and outgoing Challenges by `tableFor`, and a viewer who had
 * been brought in AND put the same question up appeared in both — two rows about
 * one relationship, neither able to see the other. That is how post-action came
 * to have four owners, and this is the same mistake one surface across.
 *
 * So both sides are read here and merged by market. The component gets a settled
 * `state` and renders it; it never reconstructs a state from raw tables.
 *
 * EVERY READ IS BOUNDED, like the rest of `market_calls` access. Nothing here may
 * become a graph traversal, and the lineage walk is depth-capped for the same
 * reason `chainContextFor` is: a cycle written by a bug must not hang a read.
 */
import { serviceClient } from "@/lib/supabase-clients";
import { aliasFor } from "@/lib/wallet-identity";
import { recipientState, TABLE_SLOTS } from "@/domain/table";
import {
  cardStateFor,
  type CardPerson,
  type CardResponder,
  type ChallengeCardProjection,
  type Incoming,
  type Outgoing,
} from "@/domain/challenge-card";
import { audienceFor } from "@/lib/challenge.server";
import type { Side } from "@/domain/post-action";

/** Bounds. A living-card reader is not a feed builder. */
const READ = { cards: 60, calls: 600, maxDepth: 8 } as const;

interface CallRow {
  id: number | null;
  market_id: number;
  caller_wallet: string;
  responder_wallet: string;
  relation_at_call: string;
  called_at: string;
  responded_at: string | null;
  responded_side: string | null;
  passed_at: string | null;
  challenge_id: number | null;
}

interface ChallengeRow {
  id: number;
  challenger_wallet: string;
  market_id: number;
  created_at: string;
  closed_at: string | null;
  parent_call: number | null;
}

const sideOf = (v: unknown): Side | null => (v === "YES" || v === "NO" ? v : null);

export async function challengeCardsFor(viewer: string): Promise<ChallengeCardProjection[]> {
  const me = viewer.toLowerCase();
  if (!me) return [];
  const sb = serviceClient();

  /**
   * BOTH DIRECTIONS PLUS THE VIEWER'S OWN CHALLENGES, in three indexed reads.
   * `market_calls_responder_idx` and `market_calls_caller_idx` already cover the
   * first two; the third is `challenges_challenger_idx`.
   */
  const [received, issued, mine] = await Promise.all([
    sb.from("market_calls").select(CALL_COLUMNS).eq("responder_wallet", me).limit(READ.calls),
    sb.from("market_calls").select(CALL_COLUMNS).eq("caller_wallet", me).limit(READ.calls),
    sb
      .from("challenges")
      .select("id, challenger_wallet, market_id, created_at, closed_at, parent_call")
      .eq("challenger_wallet", me)
      .limit(READ.cards),
  ]);

  // Loudly, then throw. A blocked read here must never render as "nothing is
  // happening" — that is the confident zero this codebase keeps paying for, and
  // on this surface it would erase somebody's entire social history.
  for (const [label, res] of [
    ["received", received] as const,
    ["issued", issued] as const,
    ["mine", mine] as const,
  ])
    if (res.error) {
      console.error(`[card] ${label} unreadable`, {
        code: res.error.code,
        message: res.error.message,
      });
      throw new Error(res.error.message);
    }

  const receivedRows = (received.data ?? []) as CallRow[];
  const issuedRows = (issued.data ?? []) as CallRow[];
  const myChallenges = (mine.data ?? []) as ChallengeRow[];
  if (receivedRows.length === 0 && issuedRows.length === 0 && myChallenges.length === 0) return [];

  const marketIds = [
    ...new Set([
      ...receivedRows.map((r) => Number(r.market_id)),
      ...issuedRows.map((r) => Number(r.market_id)),
      ...myChallenges.map((c) => Number(c.market_id)),
    ]),
  ].slice(0, READ.cards);

  /**
   * WHO ELSE RELAYED OFF MY CALLS — the chain moving, read once for every card.
   *
   * A child Challenge whose `parent_call` is one of my rows is somebody carrying
   * my question to their own people. Nobody who PASSED is reachable from here:
   * a relay requires an answered call, so every name is a deliberate public act.
   */
  /**
   * WHICH CHALLENGES OWN THE CALLS ADDRESSED TO ME — needed for removal.
   *
   * Removal stops a branch; it does not delete a chain. A WAITING call whose
   * parent Challenge has been taken down must stop appearing as a live request,
   * because nobody is asking any more — but the recipient must NOT become a
   * passer, and an ANSWERED call survives as history regardless. Without this
   * read the card could not tell a live call from an abandoned one.
   */
  const parentIds = [
    ...new Set(receivedRows.map((r) => Number(r.challenge_id)).filter(Number.isFinite)),
  ];
  const { data: parents } = parentIds.length
    ? await sb.from("challenges").select("id, closed_at").in("id", parentIds)
    : { data: [] as { id: number; closed_at: string | null }[] };
  const closedParents = new Set(
    ((parents ?? []) as { id: number; closed_at: string | null }[])
      .filter((c) => c.closed_at != null)
      .map((c) => Number(c.id)),
  );

  const myCallIds = issuedRows.filter((r) => r.id != null).map((r) => Number(r.id));
  const [{ data: children }, { data: childCalls }, { data: markets }] = await Promise.all([
    myCallIds.length
      ? sb
          .from("challenges")
          .select("id, challenger_wallet, market_id, created_at, closed_at, parent_call")
          .in("parent_call", myCallIds)
      : Promise.resolve({ data: [] as ChallengeRow[] }),
    sb.from("market_calls").select("challenge_id").in("market_id", marketIds).limit(READ.calls),
    sb.from("markets").select("onchain_id, title").in("onchain_id", marketIds),
  ]);

  const childRows = (children ?? []) as ChallengeRow[];
  const childReach = new Map<number, number>();
  for (const r of (childCalls ?? []) as { challenge_id: number | null }[]) {
    const id = Number(r.challenge_id);
    if (Number.isFinite(id)) childReach.set(id, (childReach.get(id) ?? 0) + 1);
  }

  const titleOf = new Map(
    ((markets ?? []) as { onchain_id: number; title: string | null }[])
      .filter((m) => m.title)
      .map((m) => [Number(m.onchain_id), String(m.title)]),
  );

  /* ── Names, resolved once, AFTER membership is settled ─────────────────── */
  const wallets = new Set<string>();
  for (const r of receivedRows) wallets.add(String(r.caller_wallet).toLowerCase());
  for (const r of issuedRows) wallets.add(String(r.responder_wallet).toLowerCase());
  for (const c of childRows) wallets.add(String(c.challenger_wallet).toLowerCase());
  const { resolveProfiles } = await import("@/lib/profiles.server");
  const profiles = wallets.size ? await resolveProfiles([...wallets], 0) : new Map();
  const personOf = (wallet: string): CardPerson => ({
    wallet,
    name: profiles.get(wallet)?.displayName?.trim() || aliasFor(wallet),
    avatarUrl: profiles.get(wallet)?.pfpUrl ?? null,
  });

  /* ── Capacity and the relay audience, from the canonical definitions ───── */
  const liveChallenges = myChallenges.filter((c) => c.closed_at == null);
  const capacity = { active: liveChallenges.length, total: TABLE_SLOTS };

  const out: ChallengeCardProjection[] = [];
  for (const marketId of marketIds) {
    const question = titleOf.get(marketId);
    if (!question) continue;

    const incoming = incomingFor(receivedRows, marketId, personOf, closedParents);
    const outgoing = outgoingFor(
      myChallenges,
      issuedRows,
      childRows,
      childReach,
      marketId,
      personOf,
    );

    /**
     * A RELAY IS OFFERED ONLY WHERE THE WRITE WOULD SUCCEED, so eligibility uses
     * `eligibleAudience` — the SAME function `put_on_table` resolves against.
     * `KeepChainMoving` was deleted for computing its own answer to this; the
     * durable card must not become the place that answer comes back.
     */
    const audience =
      incoming?.respondedAtMs != null && capacity.active < capacity.total && !outgoing
        ? await relayAudienceFor(me, marketId)
        : { total: 0, singleRecipientName: null };

    const base: Omit<ChallengeCardProjection, "state"> = {
      marketId,
      question,
      incoming,
      outgoing,
      viewer: {
        canRelay: audience.total > 0,
        relayAudience: audience.total,
        relayRecipientName: audience.singleRecipientName,
        capacity,
      },
      lineage: lineageFor(receivedRows, myChallenges, marketId, personOf),
      /**
       * NOT IMPLEMENTABLE YET, AND SAID SO RATHER THAN FAKED. Nothing in the
       * schema records that a market resolved — no column on `markets`, no
       * status table. The domain handles closure correctly and terminally; this
       * is the one input it cannot be given. See the PR notes.
       */
      marketClosed: false,
    };
    out.push({ ...base, state: cardStateFor(base) });
  }

  // Newest activity first: a response today outranks a call from last week.
  return out.sort((a, b) => lastEventMs(b) - lastEventMs(a));
}

const CALL_COLUMNS =
  "id, market_id, caller_wallet, responder_wallet, relation_at_call, called_at, responded_at, responded_side, passed_at, challenge_id";

/**
 * EVERY ACTIVE CALLER, EARLIEST FIRST — and the earliest owns the lineage.
 *
 * The primary is the earliest STILL-ACTIVE call, and it is used for all four
 * things at once: displayed first, credited as `primaryCaller`, written as
 * `parent_call`, and first in provenance. If it disappears before the response,
 * the next earliest is promoted by the same sort, with no second rule.
 */
function incomingFor(
  rows: readonly CallRow[],
  marketId: number,
  personOf: (w: string) => CardPerson,
  closedParents: ReadonlySet<number>,
): Incoming | null {
  const mine = rows
    .filter((r) => Number(r.market_id) === marketId)
    .sort((a, b) => Date.parse(a.called_at) - Date.parse(b.called_at));
  if (mine.length === 0) return null;

  const answered = mine.find((r) => r.responded_at);
  /**
   * ACTIVE = not passed, and not orphaned by a removal.
   *
   * THREE THINGS HAPPEN AT ONCE HERE, and they are the removal contract:
   *
   *   a waiting call under a closed Challenge stops being live — nobody is
   *   asking any more, and the card must not keep requesting an answer for
   *   somebody who took the question down;
   *
   *   that recipient does NOT become a passer — passing is a choice, and the
   *   ledger is untouched, so nothing here writes or infers one;
   *
   *   an ANSWERED call is unaffected. `answered` is found above this filter, so
   *   a response survives its parent's removal exactly as the relationship
   *   evidence does.
   *
   * AND REMOVING ONE OF SEVERAL CALLERS DOES NOT DELETE THE CARD. The filter
   * drops that caller's row and the next earliest still-active call is promoted
   * by the same sort — one rule, no special case.
   */
  const active = mine.filter((r) => !r.passed_at && !closedParents.has(Number(r.challenge_id)));
  // With every caller gone and no answer, there is nothing live to render.
  if (active.length === 0 && !answered) return null;
  const ordered = active.length > 0 ? active : mine.filter((r) => r.responded_at);
  const primary = ordered[0];

  return {
    callers: ordered.map((r) => personOf(String(r.caller_wallet).toLowerCase())),
    primaryCall: primary?.id != null ? Number(primary.id) : null,
    primaryCaller: primary ? personOf(String(primary.caller_wallet).toLowerCase()) : null,
    primaryCallerSide: null,
    respondedAtMs: answered?.responded_at ? Date.parse(answered.responded_at) : null,
    respondedSide: sideOf(answered?.responded_side),
  };
}

function outgoingFor(
  challenges: readonly ChallengeRow[],
  issued: readonly CallRow[],
  children: readonly ChallengeRow[],
  childReach: ReadonlyMap<number, number>,
  marketId: number,
  personOf: (w: string) => CardPerson,
): Outgoing | null {
  const ch = challenges
    .filter((c) => Number(c.market_id) === marketId)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (!ch) return null;

  const recipients = issued.filter((r) => Number(r.challenge_id) === Number(ch.id));
  let showedUp = 0;
  let passed = 0;
  let waiting = 0;
  const responders: CardResponder[] = [];
  for (const r of recipients) {
    const state = recipientState({
      respondedAtMs: r.responded_at ? Date.parse(r.responded_at) : null,
      passedAtMs: r.passed_at ? Date.parse(r.passed_at) : null,
    });
    if (state === "showed_up") {
      showedUp += 1;
      responders.push({
        ...personOf(String(r.responder_wallet).toLowerCase()),
        side: sideOf(r.responded_side),
        atMs: Date.parse(r.responded_at as string),
      });
    } else if (state === "passed") passed += 1;
    else waiting += 1;
  }

  /**
   * UNIQUE PEOPLE, not child rows. One person who relays two of my calls in the
   * same market is one person who kept it moving.
   */
  const byRelayer = new Map<string, { atMs: number; reach: number }>();
  let relayReach = 0;
  for (const c of children) {
    if (Number(c.market_id) !== marketId) continue;
    const w = String(c.challenger_wallet).toLowerCase();
    const reach = childReach.get(Number(c.id)) ?? 0;
    relayReach += reach;
    const at = Date.parse(c.created_at);
    const held = byRelayer.get(w);
    /**
     * ONE PERSON, THEIR LATEST RELAY, THEIR OWN TOTAL. Reach SUMS across their
     * relays because each opened real tables; the timestamp takes the most
     * recent because that is when this person last kept it moving. A parse
     * failure contributes reach without inventing a time.
     */
    byRelayer.set(w, {
      atMs: Math.max(held?.atMs ?? 0, Number.isFinite(at) ? at : 0),
      reach: (held?.reach ?? 0) + reach,
    });
  }

  return {
    challengeId: Number(ch.id),
    reached: recipients.length,
    showedUp,
    passed,
    waiting,
    responders: responders.sort((a, b) => b.atMs - a.atMs),
    relayers: [...byRelayer].map(([w, v]) => ({ ...personOf(w), atMs: v.atMs, reach: v.reach })),
    relayReach,
    closedAtMs: ch.closed_at ? Date.parse(ch.closed_at) : null,
  };
}

/**
 * WHERE THIS QUESTION CAME FROM — a walk, bounded, never a stored path.
 *
 * `through` is whoever brought the viewer in; `startedBy` is the root of the
 * pointer chain. Depth is derived rather than stored so it cannot disagree with
 * the lineage it describes.
 */
function lineageFor(
  received: readonly CallRow[],
  challenges: readonly ChallengeRow[],
  marketId: number,
  personOf: (w: string) => CardPerson,
): ChallengeCardProjection["lineage"] {
  const first = received
    .filter((r) => Number(r.market_id) === marketId)
    .sort((a, b) => Date.parse(a.called_at) - Date.parse(b.called_at))[0];
  if (!first) return { startedBy: null, through: null, depth: 0 };

  const through = personOf(String(first.caller_wallet).toLowerCase()).name;
  const byId = new Map(challenges.map((c) => [Number(c.id), c]));
  let cursor = first.challenge_id != null ? byId.get(Number(first.challenge_id)) : undefined;
  let startedBy = through;
  let depth = 1;
  for (let hop = 0; hop < READ.maxDepth && cursor; hop++) {
    startedBy = personOf(String(cursor.challenger_wallet).toLowerCase()).name;
    if (cursor.parent_call == null) break;
    const next = challenges.find((c) => Number(c.id) === Number(cursor?.parent_call));
    if (!next || next.id === cursor.id) break;
    cursor = next;
    depth += 1;
  }
  return { startedBy, through, depth };
}

/**
 * THE CANONICAL AUDIENCE, asked only when a relay is actually on the table.
 *
 * `audienceFor` rather than `eligibleAudience` because the BUTTON needs a name
 * for an audience of one, and names are resolved after membership there. It is
 * the same membership either way — `audienceFor` calls `eligibleAudience` — so
 * there is still one definition of who can be asked.
 *
 * A refused read is not an audience of zero. On this surface the only
 * consequence is that the offer is withheld, which is the correct silence.
 */
async function relayAudienceFor(
  me: string,
  marketId: number,
): Promise<{ total: number; singleRecipientName: string | null }> {
  const res = await audienceFor(me, marketId);
  return res.status === "available"
    ? { total: res.total, singleRecipientName: res.singleRecipientName }
    : { total: 0, singleRecipientName: null };
}

function lastEventMs(p: ChallengeCardProjection): number {
  return Math.max(
    p.incoming?.respondedAtMs ?? 0,
    p.outgoing?.responders[0]?.atMs ?? 0,
    p.outgoing?.closedAtMs ?? 0,
  );
}
