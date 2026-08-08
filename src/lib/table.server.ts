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
import { qualifiedCallers, type Sb } from "@/lib/challenge.server";
import { TABLE_SLOTS, tableProgress, shouldAutoClose, type RecipientFact } from "@/domain/table";

export interface TableRow {
  id: number;
  marketId: number;
  title: string | null;
  createdAtMs: number;
  /** Everyone it reached, in the state they are in now. */
  recipients: RecipientFact[];
}

interface ChallengeRecord {
  id: number;
  market_id: number;
  slot_no: number;
  created_at: string;
  closed_at: string | null;
}

/** Postgres unique violation — a taken slot, or a market already up. */
const CONFLICT = "23505";

export type PutResult =
  | { ok: true; id: number; reached: number }
  | { ok: false; reason: "full" | "already_up" | "no_audience" | "failed" };

/**
 * PUT IT ON THE TABLE.
 *
 * THE CAP IS NOT CHECKED HERE, IT IS COLLIDED WITH. Counting active rows and then
 * inserting is a read-then-write race: two tabs both count two, both insert, and
 * the person has four. Instead this walks the slots and lets the partial unique
 * index reject a taken one — so the loop below is not retry-on-failure, it IS the
 * allocator. Falling out of it means all three are genuinely occupied, decided by
 * Postgres rather than by arithmetic that was true a moment ago.
 */
export async function putOnTable(wallet: string, marketId: number): Promise<PutResult> {
  const sb = serviceClient();
  const me = wallet.toLowerCase();

  // WHO IT WILL REACH, resolved BEFORE a slot is taken. A Challenge nobody can
  // receive should not consume one of three — the person would spend an editorial
  // choice on silence and have no way to know why.
  const callers = await qualifiedCallers(sb, me);
  const audience = [...callers.entries()].filter(([w]) => w !== me);
  if (audience.length === 0) return { ok: false, reason: "no_audience" };

  let id: number | null = null;
  for (let slot = 1; slot <= TABLE_SLOTS; slot++) {
    const { data, error } = await sb
      .from("challenges")
      .insert({ challenger_wallet: me, market_id: marketId, slot_no: slot })
      .select("id")
      .maybeSingle();
    if (!error && data) {
      id = Number((data as { id: number }).id);
      break;
    }
    if (error?.code !== CONFLICT) {
      console.error("[table] could not put on the table", {
        code: error?.code,
        message: error?.message,
      });
      return { ok: false, reason: "failed" };
    }
    // A conflict is either "this slot is taken" or "this market is already up",
    // and the second is not something to retry into the next slot. Distinguished
    // by asking, because the two indexes raise the same code.
    const { data: dup } = await sb
      .from("challenges")
      .select("id")
      .eq("challenger_wallet", me)
      .eq("market_id", marketId)
      .is("closed_at", null)
      .maybeSingle();
    if (dup) return { ok: false, reason: "already_up" };
  }
  if (id == null) return { ok: false, reason: "full" };

  // THE FREEZE. One row per qualified person, `relation_at_call` stamped as it is
  // right now and never recomputed. 23505 is swallowed for the same reason it
  // always was: a repeat must never rewrite the relationship a call was made under.
  const { error: callsErr } = await sb.from("market_calls").insert(
    audience.map(([responder, caller]) => ({
      market_id: marketId,
      caller_wallet: me,
      responder_wallet: responder,
      relation_at_call: caller.relation,
      challenge_id: id,
    })),
  );
  if (callsErr && callsErr.code !== CONFLICT) {
    console.error("[table] challenge is up but its audience was not recorded", {
      code: callsErr.code,
      message: callsErr.message,
      challengeId: id,
    });
  }
  return { ok: true, id, reached: audience.length };
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
export async function passCall(wallet: string, marketId: number): Promise<boolean> {
  const sb = serviceClient();
  const { error } = await sb
    .from("market_calls")
    .update({ passed_at: new Date().toISOString() })
    .eq("market_id", marketId)
    .eq("responder_wallet", wallet.toLowerCase())
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
export async function tableFor(wallet: string): Promise<TableRow[]> {
  const sb = serviceClient();
  const me = wallet.toLowerCase();

  const { data: rows, error } = await sb
    .from("challenges")
    .select("id, market_id, slot_no, created_at, closed_at")
    .eq("challenger_wallet", me)
    .is("closed_at", null)
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
    sb.from("market_calls").select("challenge_id, responded_at, passed_at").in("challenge_id", ids),
    sb.from("markets").select("onchain_id, title").in("onchain_id", marketIds),
  ]);

  const byChallenge = new Map<number, RecipientFact[]>();
  for (const c of (calls ?? []) as {
    challenge_id: number | null;
    responded_at: string | null;
    passed_at: string | null;
  }[]) {
    const key = Number(c.challenge_id);
    if (!Number.isFinite(key)) continue;
    (byChallenge.get(key) ?? byChallenge.set(key, []).get(key)!).push({
      respondedAtMs: c.responded_at ? Date.parse(c.responded_at) : null,
      passedAtMs: c.passed_at ? Date.parse(c.passed_at) : null,
    });
  }
  const titleOf = new Map(
    ((markets ?? []) as { onchain_id: number; title: string | null }[]).map((m) => [
      Number(m.onchain_id),
      m.title,
    ]),
  );

  const out: TableRow[] = [];
  for (const r of active) {
    const recipients = byChallenge.get(Number(r.id)) ?? [];
    // Everyone answered — it has done its job, so it stops occupying a slot. Fire
    // and forget: a failed close costs one stale row, never this render.
    if (shouldAutoClose(recipients)) {
      void takeOffTable(me, Number(r.id), "all_responded");
      continue;
    }
    out.push({
      id: Number(r.id),
      marketId: Number(r.market_id),
      title: titleOf.get(Number(r.market_id)) ?? null,
      createdAtMs: Date.parse(r.created_at),
      recipients,
    });
  }
  return out;
}

/** How many slots are in use right now — the number the capacity line reads. */
export async function activeCount(wallet: string): Promise<number> {
  return (await tableFor(wallet)).length;
}

/** Re-exported so callers never reach past this module for the shape. */
export { tableProgress };
