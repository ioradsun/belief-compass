/**
 * PUTTING SOMETHING ON THE TABLE — the writes behind an outbound Challenge.
 *
 * `domain/table` owns what the words mean; this owns what actually happens. Four
 * verbs, and each one exists because the previous design could not express it:
 *
 *   putOnTable    choose a market, freeze who it reaches
 *   takeOffTable  end it early, without erasing who showed up
 *   passCall      "not for me", durable now that a creator sees progress
 *   tableFor      what is on somebody's table, and what became of each one
 *
 * THE AUDIENCE IS FROZEN AT CREATION, and that is the whole reason a denominator
 * is worth printing. The recipient rows are written once, when the Challenge goes
 * up, from the same qualified set the rail has always derived from. If somebody's
 * DNA changes next week, "3 of 8 showed up" still says 8 — because eight people
 * really did get the chance. A live-recomputed audience would silently rewrite
 * history every time the graph moved, and a fraction whose denominator drifts is
 * worse than no fraction at all.
 *
 * IT REUSES `market_calls` RATHER THAN INVENTING A SECOND LEDGER. A Challenge's
 * recipients ARE calls — the same rows the People and Profile surfaces read, with
 * the same frozen `relation_at_call`. All V2 adds is `challenge_id`, so a row can
 * say which deliberate act produced it. One relationship ledger, still.
 */
import { serviceClient } from "@/lib/supabase-clients";
import { aliasFor } from "@/lib/wallet-identity";
import { eligibleAudience, type Sb } from "@/lib/challenge.server";
import type { RecordMode } from "@/domain/simulation";
import {
  tableProgress,
  shouldAutoClose,
  finishedVisible,
  FINISHED_WINDOW_MS,
  type RecipientFact,
  type CloseReason,
  type Responder,
} from "@/domain/table";

export interface TableRow {
  id: number;
  marketId: number;
  title: string | null;
  createdAtMs: number;
  /** Everyone it reached, in the state they are in now. */
  recipients: RecipientFact[];
  /**
   * ENDED, AND STILL WORTH SEEING. Null while it is live.
   *
   * A finished Challenge is not a deleted one. It stays on its author's table for
   * a week so they actually find out what happened, and it does NOT occupy a slot
   * — the thing it was holding is over. Both halves matter: without the row the
   * creator never learns, and without freeing the slot a week of good outcomes
   * would lock them out of asking anything else.
   */
  closedAtMs: number | null;
  closeReason: CloseReason | null;
  /**
   * WHO SHOWED UP, NAMED — the payoff the card could never print.
   *
   * The creator has always been told a COUNT ("3 of 8 showed up") because the
   * aggregate rule was written for PASSES, where naming somebody would build a
   * ledger of rejection. A responder is the opposite kind of fact: they took a
   * public on-chain position, and the tape has named them since it shipped
   * ("Sarah and Mike showed up for you"). This is that sentence arriving on the
   * card the asking happened from.
   *
   * NEWEST FIRST, and passers are ABSENT — not anonymised, absent. Nothing in
   * this array can identify somebody who declined.
   */
  responders: Responder[];
}

interface ChallengeRecord {
  id: number;
  market_id: number;
  slot_no: number;
  created_at: string;
  closed_at: string | null;
  close_reason: string | null;
}

export type PutResult =
  | { ok: true; id: number; reached: number }
  | {
      ok: false;
      /**
       * EVERY REFUSAL MEANS THE SAME THING ABOUT THE DATABASE: nothing was
       * written, no slot was taken, and no carried call was repointed. They
       * differ only in what to say to the reader.
       *
       *   full                  three are already up
       *   already_up            this question is one of them
       *   no_audience           nobody qualifies to be asked
       *   audience_unavailable  the audience read was REFUSED — not nobody
       *   bad_parent            the relay pointed at a call that does not
       *                         describe a relay: wrong market, not addressed
       *                         to this person, or never answered
       *   no_reach              the write landed on nobody. Rolled back rather
       *                         than left on the table asking no one.
       *   failed                anything else, already logged
       */
      reason:
        | "full"
        | "already_up"
        | "no_audience"
        | "audience_unavailable"
        | "bad_parent"
        | "no_reach"
        | "failed";
    };

/** The RPC's shape. Untyped in the generated client until types are regenerated. */
type RpcClient = {
  rpc: (
    name: string,
    args: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>;
};

/**
 * PUT IT ON THE TABLE — one round trip, and it is one transaction.
 *
 * THIS USED TO BE FOUR WRITES AND IT COULD LEAVE A CORPSE. Take a slot, insert
 * the Challenge, repoint last run's unanswered calls at it, write the
 * recipients — and only the first two could fail loudly. A failed recipient
 * write was logged and swallowed, and this function returned `ok: true` with
 * `reached: 0`: a Challenge that exists, holds one of three editorial slots,
 * asks nobody, prints no progress sentence, and can never auto-close because
 * `allResponded` is false at zero. It holds that slot forever.
 *
 * A COMPENSATING CLOSE WOULD NOT HAVE FIXED IT, which is why this is an RPC
 * rather than a tidy-up branch. By the time the recipient write fails, step
 * three has already repointed last run's unanswered calls at the new Challenge.
 * Closing it strands those people — the question they are still being asked
 * quietly stops being asked, and the pointer that said which Challenge it
 * belonged to has been overwritten, so there is nothing to restore. The write
 * has to be undone, not apologised for.
 *
 * So the slot allocation, the Challenge row, the carry, the recipient upsert and
 * the reach count all live in `put_on_table` and commit together or not at all.
 * The invariant a caller may rely on:
 *
 *   ok: true   →  a durable, active Challenge exists AND reached > 0
 *   ok: false  →  no Challenge exists, no slot was consumed, nothing was carried
 *
 * THE CAP IS STILL COLLIDED WITH, NEVER COUNTED — the slot walk moved into the
 * function unchanged, still letting the partial unique index reject a taken slot
 * rather than trusting a count that was true a moment ago.
 *
 * AND THERE IS NO FALLBACK TO THE OLD PATH. If the function is not deployed the
 * write refuses. Falling back would restore the exact defect this replaces, and
 * a Challenge that never went up is recoverable in a way a ghost holding a slot
 * is not.
 */
export async function putOnTable(
  wallet: string,
  marketId: number,
  /**
   * THE CALL THIS RELAY ANSWERS — how a chain keeps its lineage.
   *
   * When somebody relays a question straight after showing up for it, the new
   * Challenge points back at the call that brought them in, and provenance is a
   * walk up that pointer rather than a guess from timestamps. Null for a market
   * somebody put up on their own initiative, which is most of them.
   *
   * VALIDATED SERVER-SIDE, inside the transaction. The foreign key only proves
   * the call exists; the function additionally requires that it is in this
   * market, was addressed to this person, and was actually answered.
   */
  parentCall?: number | null,
  /**
   * WHICH LEDGER THIS QUESTION IS BEING PUT UP IN.
   *
   * It scopes the audience (a Simulation Challenge reaches only active Simulation
   * users), the three-slot capacity, and the row itself — so a Challenge put up
   * in Simulation cannot outlive Simulation or occupy a real slot.
   */
  mode: RecordMode = "REAL",
): Promise<PutResult> {
  const sb = serviceClient();
  const me = wallet.toLowerCase();

  /**
   * WHO IT WILL REACH, resolved BEFORE the transaction opens.
   *
   * THE SAME FUNCTION THE PREVIEW CALLS, and that is the fix rather than a
   * detail. This used to read `qualifiedCallers` with no market-scoped exclusion
   * at all while the preview excluded current holders — so the count shown and
   * the audience written were decided by different rules, and production
   * measured the gap at 32 people across 26 positions. One definition means the
   * "8" in "3 of 8 showed up" is the same 8 the reader was promised.
   *
   * A REFUSED AUDIENCE IS NOT AN EMPTY ONE, AND IT IS NOT PERMISSION. The
   * exclusions are what keep a Challenge away from people who already answered
   * this market. If one of those reads fails we do not know who to leave out —
   * so nothing is written and the caller is told the audience was unavailable.
   */
  const resolved = await eligibleAudience(sb, me, marketId, mode);
  if (resolved.status === "failed") return { ok: false, reason: "audience_unavailable" };
  const audience = resolved.members.filter((m) => m.wallet !== me);
  if (audience.length === 0) return { ok: false, reason: "no_audience" };

  const { data, error } = await (sb as unknown as RpcClient).rpc("put_on_table", {
    p_challenger: me,
    p_market_id: marketId,
    p_parent_call: typeof parentCall === "number" ? parentCall : null,
    /**
     * THE RELATION, NEVER THE GROUP. `group` is not on a candidate and is not
     * sent — "Still Forming" is a heading, and a row that stored it would make
     * presentation copy permanent. What is frozen is what the engine believed:
     * `neutral`, or `insufficient` with the provenance that let them in.
     */
    p_audience: audience.map((m) => ({ wallet: m.wallet, relation: m.relationAtCall })),
    p_mode: mode,
  });

  if (error) {
    /**
     * `PGRST202` is "no function matches" — the migration has not been applied.
     * Said differently from a runtime failure, because the fix is different and
     * one is permanent until somebody acts.
     */
    if (error.code === "PGRST202") {
      console.error("[table] put_on_table is not deployed — refusing rather than writing", {
        message: error.message,
      });
    } else {
      console.error("[table] put_on_table failed", { code: error.code, message: error.message });
    }
    return { ok: false, reason: "failed" };
  }

  const res = (data ?? {}) as {
    ok?: boolean;
    id?: number;
    reached?: number;
    reason?: string;
    detail?: string;
    code?: string;
  };
  if (res.ok === true && typeof res.id === "number" && (res.reached ?? 0) > 0) {
    return { ok: true, id: Number(res.id), reached: Number(res.reached) };
  }
  // The function rolled itself back. `detail` never reaches a screen; it is the
  // one place a check-constraint rejection or a timeout is legible at all.
  if (res.detail || res.code)
    console.error("[table] challenge rolled back", {
      reason: res.reason,
      code: res.code,
      detail: res.detail,
      marketId,
    });
  const reason = res.reason;
  return {
    ok: false,
    reason:
      reason === "full" ||
      reason === "already_up" ||
      reason === "no_audience" ||
      reason === "bad_parent" ||
      reason === "no_reach"
        ? reason
        : "failed",
  };
}

/**
 * TAKE IT OFF THE TABLE — or let it close itself.
 *
 * Closing frees the slot and erases nothing. Every recipient row survives with its
 * stamps, so who showed up remains part of the relationship forever; the Challenge
 * simply stops asking. `close_reason` keeps "I took it down" and "everyone
 * answered" distinguishable, which are different stories about the same end state.
 */
export async function takeOffTable(
  wallet: string,
  challengeId: number,
  reason: "creator" | "all_responded" = "creator",
): Promise<boolean> {
  const sb = serviceClient();
  const { error } = await sb
    .from("challenges")
    .update({ closed_at: new Date().toISOString(), close_reason: reason })
    .eq("id", challengeId)
    .eq("challenger_wallet", wallet.toLowerCase())
    .is("closed_at", null);
  if (error) {
    console.error("[table] could not close", { code: error.code, message: error.message });
    return false;
  }
  return true;
}

/**
 * NOT FOR ME — durable, and deliberately narrow.
 *
 * This reverses a decision made on purpose: dismissal used to be viewer-local so
 * that no ledger of who declined whom could exist. That was right when nobody was
 * owed an answer. A creator now sees what became of the thing they put up, and
 * "1 passed" cannot be honest if the server never learns it.
 *
 * The limits that keep the original reasoning intact: it writes ONE column on the
 * recipient's own row, it never touches `responded_at`, and nothing downstream
 * reads it except Challenge progress. Conviction Match cannot see it. Showing Up
 * cannot see it. The creator sees a count, never a name.
 */
export async function passCall(
  wallet: string,
  marketId: number,
  mode: RecordMode = "REAL",
): Promise<boolean> {
  const sb = serviceClient();
  const { error } = await sb
    .from("market_calls")
    .update({ passed_at: new Date().toISOString() })
    .eq("market_id", marketId)
    .eq("responder_wallet", wallet.toLowerCase())
    .eq("mode", mode)
    .is("responded_at", null)
    .is("passed_at", null);
  if (error) {
    console.error("[table] could not record a pass", { code: error.code, message: error.message });
    return false;
  }
  return true;
}

/**
 * WHAT IS ON SOMEBODY'S TABLE, with what became of each one.
 *
 * Also the auto-close trigger: reading a table is the natural moment to notice a
 * Challenge whose recipients have all answered. Doing it here rather than on a
 * schedule means no worker, no cron and no drift between what the creator sees and
 * what the database holds — the close happens the first time anybody looks.
 */
export async function tableFor(wallet: string, mode: RecordMode = "REAL"): Promise<TableRow[]> {
  const sb = serviceClient();
  const me = wallet.toLowerCase();

  /**
   * OPEN, PLUS WHAT RECENTLY ENDED.
   *
   * This used to read `.is("closed_at", null)` alone, and that one clause was the
   * bug: combined with the auto-close below, a Challenge everybody answered was
   * closed and dropped in the SAME pass. The creator opened Yours and found
   * nothing — the best outcome the product can produce, deleted before its author
   * ever saw it. A week of history costs one predicate.
   */
  const cutoff = new Date(Date.now() - FINISHED_WINDOW_MS).toISOString();
  const { data: rows, error } = await sb
    .from("challenges")
    .select("id, market_id, slot_no, created_at, closed_at, close_reason")
    .eq("challenger_wallet", me)
    .eq("mode", mode)
    .or(`closed_at.is.null,closed_at.gte.${cutoff}`)
    .order("created_at", { ascending: false });
  // Loudly, then empty. A failed read here must never be reported as "nothing on
  // your table" — that is the confident zero this codebase keeps paying for.
  if (error) {
    console.error("[table] could not read the table", {
      code: error.code,
      message: error.message,
    });
    throw new Error(error.message);
  }
  const active = (rows ?? []) as ChallengeRecord[];
  if (active.length === 0) return [];

  const ids = active.map((r) => Number(r.id));
  const marketIds = [...new Set(active.map((r) => Number(r.market_id)))];
  const [{ data: calls }, { data: markets }] = await Promise.all([
    /* `responder_wallet` and `responded_side` join the read so the card can name
       who turned up and say which way they went. The side may be null on rows
       stamped before it was kept, and on rows written while the chain migration
       is still unapplied — the card simply prints no side, which is the honest
       degradation rather than a guess at somebody's position. */
    sb
      .from("market_calls")
      .select("challenge_id, responded_at, passed_at, responder_wallet, responded_side")
      .in("challenge_id", ids),
    sb.from("markets").select("onchain_id, title").in("onchain_id", marketIds),
  ]);

  const byChallenge = new Map<number, RecipientFact[]>();
  /** Only people who ANSWERED, newest first. A passer can never enter this map. */
  const answeredBy = new Map<
    number,
    { wallet: string; atMs: number; side: "YES" | "NO" | null }[]
  >();
  for (const c of (calls ?? []) as {
    challenge_id: number | null;
    responded_at: string | null;
    passed_at: string | null;
    responder_wallet: string | null;
    responded_side: string | null;
  }[]) {
    const key = Number(c.challenge_id);
    if (!Number.isFinite(key)) continue;
    (byChallenge.get(key) ?? byChallenge.set(key, []).get(key)!).push({
      respondedAtMs: c.responded_at ? Date.parse(c.responded_at) : null,
      passedAtMs: c.passed_at ? Date.parse(c.passed_at) : null,
    });
    if (c.responded_at && c.responder_wallet) {
      (answeredBy.get(key) ?? answeredBy.set(key, []).get(key)!).push({
        wallet: String(c.responder_wallet).toLowerCase(),
        atMs: Date.parse(c.responded_at),
        side: c.responded_side === "YES" || c.responded_side === "NO" ? c.responded_side : null,
      });
    }
  }

  /**
   * NAMES FOR THE PEOPLE WHO TURNED UP — one profile read for the whole table.
   *
   * `resolveProfiles` falls back to the wallet alias, so nobody is ever rendered
   * as "someone": the domain refuses to speak about a person it cannot name, and
   * an unnamed avatar would be the feeling without the person.
   */
  const responderWallets = [...new Set([...answeredBy.values()].flat().map((r) => r.wallet))];
  const { resolveProfiles } = await import("@/lib/profiles.server");
  const profiles = responderWallets.length ? await resolveProfiles(responderWallets, 0) : new Map();
  const nameOf = (w: string) => profiles.get(w)?.displayName?.trim() || aliasFor(w);
  const titleOf = new Map(
    ((markets ?? []) as { onchain_id: number; title: string | null }[]).map((m) => [
      Number(m.onchain_id),
      m.title,
    ]),
  );

  const now = Date.now();
  const out: TableRow[] = [];
  for (const r of active) {
    const recipients = byChallenge.get(Number(r.id)) ?? [];
    let closedAtMs = r.closed_at ? Date.parse(r.closed_at) : null;
    let closeReason = (r.close_reason ?? null) as CloseReason | null;

    // Everyone answered — it has done its job, so it stops occupying a slot. Fire
    // and forget: a failed close costs one stale row, never this render. The row
    // itself SURVIVES the close, now marked finished, because the creator has not
    // been told yet and this render is the telling.
    if (closedAtMs == null && shouldAutoClose(recipients)) {
      void takeOffTable(me, Number(r.id), "all_responded");
      closedAtMs = now;
      closeReason = "all_responded";
    }
    // Aged out. The relationship keeps the record; the table does not keep a
    // souvenir.
    if (closedAtMs != null && !finishedVisible(closedAtMs, now)) continue;

    out.push({
      id: Number(r.id),
      marketId: Number(r.market_id),
      title: titleOf.get(Number(r.market_id)) ?? null,
      createdAtMs: Date.parse(r.created_at),
      recipients,
      closedAtMs,
      closeReason,
      // Newest first: the card leads with the person who just turned up, which
      // is the only part of this that is news.
      responders: (answeredBy.get(Number(r.id)) ?? [])
        .sort((a, b) => b.atMs - a.atMs)
        .map((x) => ({ name: nameOf(x.wallet), side: x.side })),
    });
  }
  return out;
}

/**
 * How many slots are in use right now — the number the capacity line reads.
 *
 * FINISHED ROWS DO NOT COUNT, and this is the reason the distinction exists in the
 * payload at all. A week of successful Challenges must never read as a full table:
 * the whole point of closing is that the slot came back.
 */
export function activeRows(rows: readonly TableRow[]): TableRow[] {
  return rows.filter((r) => r.closedAtMs == null);
}

export async function activeCount(wallet: string): Promise<number> {
  return activeRows(await tableFor(wallet)).length;
}

/** Re-exported so callers never reach past this module for the shape. */
export { tableProgress };

/**
 * WHAT COULD GO UP — the invitation behind an empty slot.
 *
 * An empty slot is not a state anybody needs described; it is an offer. These are
 * the markets this wallet is actually IN — one they authored, or one they hold a
 * position in — that are not already on the table. Nothing else qualifies: asking
 * your people about a question you have not answered yourself is not a challenge,
 * it is a forward.
 */
export interface TableCandidate {
  marketId: number;
  title: string | null;
}

export async function tableCandidates(wallet: string, limit = 3): Promise<TableCandidate[]> {
  if (limit <= 0) return [];
  const sb = serviceClient();
  const me = wallet.toLowerCase();

  const [{ data: beliefs }, { data: authored }, { data: up }] = await Promise.all([
    sb
      .from("wallet_beliefs")
      .select("onchain_id, last_trade_at, yes_shares, no_shares")
      .eq("wallet", me)
      .order("last_trade_at", { ascending: false, nullsFirst: false })
      .limit(40),
    sb
      .from("markets")
      .select("onchain_id, title, first_seen")
      .eq("author_wallet", me)
      .order("first_seen", { ascending: false })
      .limit(20),
    sb.from("challenges").select("market_id").eq("challenger_wallet", me).is("closed_at", null),
  ]);

  // Already up, in any slot. A second card offering what is already on the table
  // would be an invitation to collide with the unique index.
  const taken = new Set((up ?? []).map((r) => Number((r as { market_id: number }).market_id)));

  const ids: number[] = [];
  for (const b of (beliefs ?? []) as Array<{
    onchain_id: number;
    yes_shares: number;
    no_shares: number;
  }>) {
    const held = Number(b.yes_shares ?? 0) + Number(b.no_shares ?? 0);
    if (held <= 0) continue;
    const id = Number(b.onchain_id);
    if (!taken.has(id) && !ids.includes(id)) ids.push(id);
  }
  for (const m of (authored ?? []) as Array<{ onchain_id: number }>) {
    const id = Number(m.onchain_id);
    if (id != null && !taken.has(id) && !ids.includes(id)) ids.push(id);
  }
  const picked = ids.slice(0, limit);
  if (picked.length === 0) return [];

  const { data: titles } = await sb
    .from("markets")
    .select("onchain_id, title")
    .in("onchain_id", picked);
  const titleOf = new Map(
    ((titles ?? []) as Array<{ onchain_id: number; title: string | null }>).map((m) => [
      Number(m.onchain_id),
      m.title,
    ]),
  );
  return picked.map((id) => ({ marketId: id, title: titleOf.get(id) ?? null }));
}
