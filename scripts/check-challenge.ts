/**
 * check-challenge — is the social layer actually producing participation?
 *
 * SUCCESS IS PARTICIPATION. Not markets created, not calls made. Both measure
 * how hard people worked, and a product that optimises them ends up with more
 * markets nobody is in — the exact failure this whole effort exists to fix. So
 * the numbers here are answers, backings, and markets that reached a real
 * conversation. Calls appear only as the denominator the outcomes are read
 * against.
 *
 * WHAT REPLACED WHAT. This was check-launch, measuring invitations sent →
 * viewed → joined. Invitations are gone; a Challenge is created by somebody's
 * conviction rather than by pressing a button, so the funnel is now called →
 * answered, and it can be broken down by the relationship that made the call —
 * which is the question a recruitment panel could never answer.
 *
 * THE BASELINE, measured before any of this shipped:
 *
 *   2,788 markets · 71.2% with ZERO participants · 2.3% with five or more
 *
 * Everything below is read against those two numbers. If the ≥5 share is not
 * moving, Launch Mode is decoration however good the panels look.
 *
 * IT ALSO SAYS WHAT IT CANNOT MEASURE, which matters more here than usual.
 * `DuplicateSuggestions` emitted NOTHING for its entire life, so a
 * consolidation feature that diverted nobody was indistinguishable from one
 * that worked perfectly. That is now instrumented — but only from the moment it
 * shipped, and there is no honest way to backfill a click that was never
 * recorded. A report that quietly implied otherwise would be worse than none.
 *
 * Run:  npx tsx scripts/check-challenge.ts   (npm run check:challenge)
 *       --json   machine-readable, for tracking the numbers over time
 */
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
/**
 * The service key sees everything; the publishable key sees `market_state` and
 * `wallet_beliefs` and nothing else. Both are accepted, and A BLOCKED SECTION IS
 * NEVER REPORTED AS ZERO — that confusion is the exact failure mode this
 * codebase keeps paying for (`Number(null) === 0`, a confident zero from an
 * absent read). A section that could not be read says so.
 */
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_PUBLISHABLE_KEY ??
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const privileged = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL and a key (SERVICE_ROLE or PUBLISHABLE).");
  process.exit(2);
}

const JSON_OUT = process.argv.includes("--json");

/** Measured on 2026-08-07, before Launch Mode shipped. The thing to beat. */
const BASELINE = { markets: 2788, zeroPct: 71.2, fivePlusPct: 2.3 } as const;
/** A market with this many directional believers is a conversation. */
const CONVERSATION_SIZE = 5;

/** Rows, or `null` meaning WE COULD NOT LOOK. Never an empty array for that. */
type Read<T> = { rows: T[]; blocked: false } | { rows: null; blocked: true; why: string };

/**
 * PRIVILEGE IS DECLARED, NOT INFERRED FROM THE RESPONSE.
 *
 * `user_events` grants SELECT to `authenticated` only and its RLS policy is
 * `USING (false)`, so a publishable-key read comes back 200 WITH ZERO ROWS
 * rather than 401. Trusting that would print "0 diversions" for a table we were
 * never allowed to see — the precise confident-zero this report exists to
 * prevent, committed by the report itself. So tables that need the service key
 * say so up front and are marked unknown without asking.
 */
async function page<T>(
  table: string,
  select: string,
  filter = "",
  needsService = false,
): Promise<Read<T>> {
  if (needsService && !privileged) {
    return { rows: null, blocked: true, why: "needs SUPABASE_SERVICE_ROLE_KEY" };
  }
  const out: T[] = [];
  // Supabase caps `.select()` at 1000 rows and TRUNCATES SILENTLY, so every
  // read here is explicitly paged. A report that quietly stopped at 1000 would
  // be confidently wrong, which is the one thing a metric must never be.
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${url}/rest/v1/${table}?select=${select}${filter}`, {
      headers: {
        apikey: key as string,
        Authorization: `Bearer ${key}`,
        Range: `${from}-${from + 999}`,
      },
    });
    if (!res.ok) {
      return { rows: null, blocked: true, why: `${res.status} ${(await res.text()).slice(0, 90)}` };
    }
    const rows = (await res.json()) as T[];
    out.push(...rows);
    if (rows.length < 1000) return { rows: out, blocked: false };
  }
}

interface MarketState {
  onchain_id: number;
  directional_believers: number | null;
}
interface Call {
  market_id: number;
  caller_wallet: string;
  responder_wallet: string;
  /** The relationship AS IT WAS when the call was made — never recomputed. */
  relation_at_call: string;
  called_at: string;
  responded_at: string | null;
}
/**
 * The only values `relation_at_call` may hold. Mirrors the migration's CHECK.
 *
 * SIX SINCE 20260907. `neutral` and `insufficient` are the Still Forming
 * provenances — see @/domain/audience. Until that migration is applied the
 * database will REJECT the two new labels, which is worth knowing precisely
 * because the audience is written as one statement: a single rejected row rolls
 * the whole insert back and the Challenge reaches nobody.
 */
const RELATIONS = new Set(["twin", "tribe", "opp", "inverse", "neutral", "insufficient"]);
interface UserEvent {
  onchain_id: number | null;
  type: string;
  ts: string;
}
interface Belief {
  wallet: string;
  onchain_id: number;
}

const pct = (n: number, d: number) => (d > 0 ? (100 * n) / d : 0);
const fmtPct = (v: number) => `${v.toFixed(1)}%`;
/** "+1.4pp" / "−0.3pp" — a share moves in points, never in percent. */
const delta = (now: number, then: number) => {
  const d = now - then;
  return `${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(1)}pp`;
};

async function main() {
  const [states, calls, events] = await Promise.all([
    page<MarketState>("market_state", "onchain_id,directional_believers"),
    page<Call>(
      "market_calls",
      "market_id,caller_wallet,responder_wallet,relation_at_call,called_at,responded_at",
      "",
      true,
    ),
    page<UserEvent>("user_events", "onchain_id,type,ts", "&type=eq.similar_market_join", true),
  ]);

  const unreadable: string[] = [];
  if (states.blocked) unreadable.push(`market_state — ${states.why}`);
  if (calls.blocked) unreadable.push(`market_calls — ${calls.why}`);
  if (events.blocked) unreadable.push(`user_events — ${events.why}`);

  /* ── 1 · PARTICIPATION — the only success measure ─────────────────────── */

  const believers = (states.rows ?? []).map((s) => Number(s.directional_believers ?? 0));
  const total = believers.length;
  const zero = believers.filter((b) => b === 0).length;
  const fivePlus = believers.filter((b) => b >= CONVERSATION_SIZE).length;
  const zeroPct = pct(zero, total);
  const fivePlusPct = pct(fivePlus, total);

  /* ── 2 · CALLS — outcomes, with calls made as the denominator ──────────── */

  const callRows = calls.rows ?? [];
  const calledPairs = callRows.map((c) => ({
    market: Number(c.market_id),
    wallet: String(c.responder_wallet).toLowerCase(),
  }));
  const calledMarkets = [...new Set(calledPairs.map((p) => p.market))];

  // Did the invited person end up holding a side HERE? Read from live positions
  // rather than from the stored stamp, so the report never launders its own
  // bookkeeping — the stamp exists to survive an exit, not to be the evidence.
  const backedKeys = new Set<string>();
  if (calledMarkets.length > 0) {
    const held = await page<Belief>(
      "wallet_beliefs",
      "wallet,onchain_id",
      `&onchain_id=in.(${calledMarkets.join(",")})&stance_side=in.(YES,NO)`,
    );
    if (held.blocked) unreadable.push(`wallet_beliefs — ${held.why}`);
    for (const h of held.rows ?? []) {
      backedKeys.add(`${Number(h.onchain_id)}:${String(h.wallet).toLowerCase()}`);
    }
  }

  const made = callRows.length;
  const answered = callRows.filter((c) => !!c.responded_at).length;
  const backed = calledPairs.filter((p) => backedKeys.has(`${p.market}:${p.wallet}`)).length;

  // WHICH RELATIONSHIP ACTUALLY MOVES PEOPLE — the question a recruitment panel
  // could never answer, because it had no relationship frozen at send time.
  // `relation_at_call` is the snapshot taken when the call was created, so this
  // breakdown stays true even after Sarah stops being Tribe; recomputing the
  // relationship here would let history rewrite itself every time DNA shifts.
  const byRelation = new Map<string, { called: number; answered: number; backed: number }>();
  callRows.forEach((c, idx) => {
    // The column is NOT NULL with a CHECK, so this fallback should be
    // unreachable — but a row that somehow escaped it groups honestly as
    // unknown rather than being folded into one of the real relationships.
    const k = c.relation_at_call ? String(c.relation_at_call) : "(unlabelled)";
    const cur = byRelation.get(k) ?? { called: 0, answered: 0, backed: 0 };
    cur.called += 1;
    if (c.responded_at) cur.answered += 1;
    if (backedKeys.has(`${calledPairs[idx].market}:${calledPairs[idx].wallet}`)) cur.backed += 1;
    byRelation.set(k, cur);
  });

  /* ── 2b · RELATIONSHIPS — does anyone show up for anyone, repeatedly? ──── */

  // THE QUESTION THAT ACTUALLY MATTERS, and the one a call count cannot answer.
  // "Calls made" measures how hard the system worked. What we need to know is
  // whether one person's conviction causes another person to participate, and
  // then whether that keeps happening between the same two people — because a
  // relationship is repeat behaviour, not a single coincidence.
  const pairKey = (c: Call) =>
    `${String(c.caller_wallet).toLowerCase()}>${String(c.responder_wallet).toLowerCase()}`;
  const pairs = new Map<string, { called: number; answered: number }>();
  for (const c of callRows) {
    const k = pairKey(c);
    const cur = pairs.get(k) ?? { called: 0, answered: 0 };
    cur.called += 1;
    if (c.responded_at) cur.answered += 1;
    pairs.set(k, cur);
  }
  const answeredPairs = [...pairs.values()].filter((p) => p.answered > 0);
  const atLeast = (n: number) => answeredPairs.filter((p) => p.answered >= n).length;

  // RECIPROCITY — the product's highest state, and the only one worth optimising
  // for. A→B and B→A both carrying an answer means two people showed up for each
  // other, which is what "you are not alone" is made of.
  const answeredEdges = new Set(callRows.filter((c) => c.responded_at).map((c) => pairKey(c)));
  const mutual =
    [...answeredEdges].filter((k) => {
      const [a, b] = k.split(">");
      return answeredEdges.has(`${b}>${a}`);
      // Counted twice (once per direction), halved below.
    }).length / 2;

  // HOW LONG SOMEONE TAKES TO SHOW UP. Median, not mean: one person answering
  // after three weeks would drag an average into meaninglessness.
  const latencies = callRows
    .filter((c) => c.responded_at)
    .map((c) => Date.parse(c.responded_at as string) - Date.parse(c.called_at))
    .filter((ms) => Number.isFinite(ms) && ms >= 0)
    .sort((a, b) => a - b);
  const medianLatencyH =
    latencies.length > 0 ? latencies[Math.floor(latencies.length / 2)] / 3_600_000 : null;

  /* ── 3 · CONSOLIDATION — the signal that never existed ─────────────────── */

  const eventRows = events.rows ?? [];
  const diversions = eventRows.length;
  const divertedMarkets = new Set(
    eventRows.map((e) => Number(e.onchain_id)).filter(Number.isFinite),
  );

  const report = {
    key: privileged ? "service_role" : "publishable",
    unreadable,
    participation: {
      blocked: states.blocked,
      markets: total,
      zero,
      zeroPct: Number(zeroPct.toFixed(1)),
      fivePlus,
      fivePlusPct: Number(fivePlusPct.toFixed(1)),
      baseline: BASELINE,
    },
    calls: {
      blocked: calls.blocked,
      made,
      answered,
      backed,
      markets: calledMarkets.length,
      byRelation: Object.fromEntries(byRelation),
    },
    relationships: {
      blocked: calls.blocked,
      pairs: pairs.size,
      answeredPairs: answeredPairs.length,
      repeat: atLeast(3),
      strong: atLeast(5),
      mutual,
      medianLatencyH: medianLatencyH == null ? null : Number(medianLatencyH.toFixed(1)),
    },
    consolidation: { blocked: events.blocked, diversions, markets: divertedMarkets.size },
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
    const num = (v: string | number, n: number) => String(v).padStart(n);

    console.log("\nCHALLENGE — is any of this producing participation?\n");

    console.log(`read with the ${privileged ? "service-role" : "publishable"} key\n`);

    console.log("PARTICIPATION  (the only success measure)");
    const row = (label: string, now: string, was: string, d = "") =>
      console.log(`  ${pad(label, 24)}${num(now, 8)}   was ${pad(was, 8)}${d}`);
    row("markets", String(total), String(BASELINE.markets));
    row(
      "with nobody in them",
      fmtPct(zeroPct),
      fmtPct(BASELINE.zeroPct),
      delta(zeroPct, BASELINE.zeroPct),
    );
    row(
      `reached ${CONVERSATION_SIZE}+ believers`,
      fmtPct(fivePlusPct),
      fmtPct(BASELINE.fivePlusPct),
      delta(fivePlusPct, BASELINE.fivePlusPct),
    );

    console.log("\nCALLS  (outcomes — calls made are the denominator, never the score)");
    if (calls.blocked) {
      // NOT "0 calls". A read we were refused and a table that is empty are
      // different facts, and reporting them the same way is how a broken
      // pipeline gets certified as a quiet week.
      console.log("  COULD NOT READ — this section is unknown, not zero.");
    } else if (made === 0) {
      // Nobody pressed a button wrong. A call needs a qualified relationship
      // AND a market the viewer has not acted in, so an empty ledger before
      // anyone has five decisions is the expected state, not a failure.
      console.log("  No calls yet. Every number below is waiting on the first qualified caller.");
    } else {
      console.log(
        `  made                     ${num(made, 8)}   across ${calledMarkets.length} markets`,
      );
      console.log(
        `  answered                 ${num(answered, 8)}   ${fmtPct(pct(answered, made))} of made`,
      );
      console.log(
        `  backed with money        ${num(backed, 8)}   ${fmtPct(pct(backed, made))} of made`,
      );
      if (byRelation.size > 0) {
        // Sorted by answer RATE, not by volume: Twin will always be the
        // smallest bucket and would sink to the bottom of a count-ordered list
        // even if it converts twice as well as everything above it.
        console.log("\n  which relationship actually moves people");
        const rate = (v: { called: number; answered: number }) => pct(v.answered, v.called);
        for (const [rel, v] of [...byRelation].sort((a, b) => rate(b[1]) - rate(a[1]))) {
          console.log(
            `    ${pad(rel, 12)} ${num(v.called, 5)} called  ${num(v.answered, 5)} answered  ` +
              `${pad(fmtPct(rate(v)), 7)}  ${num(v.backed, 5)} backed`,
          );
        }
      }
    }

    console.log("\nRELATIONSHIPS  (the only thing worth optimising for)");
    if (calls.blocked) {
      console.log("  COULD NOT READ — this section is unknown, not zero.");
    } else if (answeredPairs.length === 0) {
      // Not a failure. It takes a qualified relationship, a surfaced call and a
      // subsequent trade — and the median pair on this platform shares one market.
      console.log("  Nobody has shown up for anybody yet.");
    } else {
      console.log(`  pairs where someone showed up  ${num(answeredPairs.length, 5)}`);
      console.log(`  ...3+ times                    ${num(atLeast(3), 5)}`);
      console.log(`  ...5+ times                    ${num(atLeast(5), 5)}`);
      console.log(
        `  MUTUAL (show up for each other)${num(mutual, 5)}   ← the product's highest state`,
      );
      if (medianLatencyH != null) {
        console.log(`  median time to show up         ${num(medianLatencyH.toFixed(1), 5)}h`);
      }
    }

    console.log("\nCONSOLIDATION  (joins from the similar-markets panel)");
    if (events.blocked) {
      console.log("  COULD NOT READ — this section is unknown, not zero.");
    } else {
      console.log(`  diverted to an existing market   ${num(diversions, 5)}`);
      console.log(`  distinct markets joined          ${num(divertedMarkets.size, 5)}`);
    }

    if (unreadable.length > 0) {
      console.log("\nNOT READ WITH THIS KEY");
      for (const u of unreadable) console.log(`  · ${u}`);
      console.log("  Re-run with SUPABASE_SERVICE_ROLE_KEY for the full picture.");
    }

    console.log("\nWHAT THIS CANNOT TELL YOU");
    console.log(
      "  · Whether a diverted person would have created a duplicate anyway. The\n" +
        "    panel records a join, not a counterfactual.\n" +
        "  · Anything before instrumentation shipped. DuplicateSuggestions emitted\n" +
        "    nothing for its whole life, and a click nobody recorded cannot be\n" +
        "    recovered — the consolidation number starts at zero by construction,\n" +
        "    not because nothing happened.\n" +
        "  · Whether someone answered BECAUSE of the call. A Challenge is surfaced,\n" +
        "    not delivered — there is no notification channel, so the ledger records\n" +
        "    that the row was eligible to be seen, not that anyone saw it. Arrival\n" +
        "    is observable; persuasion is not.\n" +
        "  · Anyone who never connected a wallet.\n" +
        "  · Whether a call that left the 30-day window was ever seen. It is counted\n" +
        "    as made, and excluded from every rate — nobody is scored on a market\n" +
        "    they can no longer reach.",
    );
    console.log("");
  }

  /* ── Structural invariants ────────────────────────────────────────────── */

  const problems: string[] = [];
  // Invariants apply only to sections we actually READ. Asserting over a
  // blocked table would turn "no access" into "bug", which is the same
  // category error the report itself refuses to make.
  //
  // NOTE ON WHAT IS *NOT* CHECKED. `answered <= made` and `backed <= made` look
  // like the obvious invariants and are worth stating only to explain their
  // absence: both are filters over `callRows`, so they hold by construction and
  // a check would be dead code dressed as diligence. The checks below are the
  // ones that can actually come out false.
  if (!calls.blocked) {
    // THE ONE WITH NO OTHER SYMPTOM. `answered` is stamped by markCallsAnswered
    // on the post-order path; `backed` is read live from wallet_beliefs. People
    // holding sides in markets they were called into, with nothing ever
    // stamped, means the stamp is not firing — and the panel would keep showing
    // Challenges that were already answered, forever, with no error anywhere.
    if (made > 0 && backed > 0 && answered === 0) {
      problems.push(
        "people hold sides in called markets but no call was ever stamped answered — " +
          "check markCallsAnswered on the completion path",
      );
    }
    // A stamp that predates the call means responded_at was written against the
    // wrong row, or the ledger is being backfilled from something other than a
    // live answer. Either way the funnel above is measuring fiction.
    const backwards = callRows.filter(
      (c) => c.responded_at && Date.parse(c.responded_at) < Date.parse(c.called_at),
    ).length;
    if (backwards > 0) problems.push(`${backwards} call(s) answered before they were made`);
    // The CHECK constraint should make this impossible. If it comes out true the
    // constraint is not there, and an unrecognised value silently invents a
    // bucket in the breakdown above rather than failing.
    const badRelations = [
      ...new Set(callRows.map((c) => String(c.relation_at_call)).filter((r) => !RELATIONS.has(r))),
    ];
    if (badRelations.length > 0) {
      problems.push(`relation_at_call holds values outside the CHECK: ${badRelations.join(", ")}`);
    }
    // The normalize trigger rejects self-calls and lowercases both wallets. A
    // self-call getting through means the trigger is gone, and it would show up
    // to the reader as their own conviction demanding a response from them.
    const selfCalls = callRows.filter(
      (c) => String(c.caller_wallet).toLowerCase() === String(c.responder_wallet).toLowerCase(),
    ).length;
    if (selfCalls > 0) {
      problems.push(`${selfCalls} call(s) where caller and responder are the same wallet`);
    }
  }

  if (problems.length > 0) {
    console.error("COUNTING PROBLEMS (these are bugs, not bad numbers):");
    for (const p of problems) console.error(`  ✗ ${p}`);
    console.error("");
    process.exitCode = 1;
  }
}

void main();
