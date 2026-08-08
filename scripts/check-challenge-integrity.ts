/**
 * check-challenge-integrity — does the ledger deserve the sentences we print?
 *
 * `check-challenge` asks whether the social layer produces participation. This
 * asks the different and harder question: is every durable claim it makes TRUE?
 *
 * Showing Up is becoming relationship reputation. "Mike showed up for you" is a
 * permanent statement about a real person, and the moment one of those is
 * unearned the whole surface is worth less than saying nothing. So each section
 * below takes one sentence the product prints and tries to falsify it against
 * the ledger.
 *
 * WHY THIS NEEDS THE SERVICE KEY, AND REFUSES TO RUN WITHOUT IT. Every question
 * here is about `market_calls`, which returns 200 WITH ZERO ROWS to the
 * publishable key — RLS filtering, not emptiness. A report that accepted that
 * would print "0 unverified answers" for a table it was never allowed to read,
 * which is the exact confident-zero this codebase keeps paying for. There is no
 * degraded mode. Either it can see the ledger or it says so and stops.
 *
 * IT MEASURES, IT DOES NOT FIX. Nothing here writes. The output is the input to
 * a decision about what to change, and several sections deliberately report a
 * number next to the sentence it makes false, so the size of each hole can be
 * compared rather than argued about.
 *
 * Run:  npx tsx scripts/check-challenge-integrity.ts   (npm run check:challenge-integrity)
 *       --json   machine-readable, for tracking the numbers over time
 */
const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "check-challenge-integrity needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.\n" +
      "\n" +
      "Measured against production with the publishable key:\n" +
      "  events            200  readable\n" +
      "  wallet_beliefs    401  permission denied\n" +
      "  viewer_dna_cache  401  permission denied\n" +
      "  market_calls      200  AND AN EMPTY ARRAY\n" +
      "\n" +
      "That last row is the whole reason this script refuses instead of degrading.\n" +
      "The two 401s are honest — they say no. `market_calls` says yes and hands\n" +
      "back nothing, because RLS filters the rows rather than blocking the read.\n" +
      "A report that trusted it would print a clean bill of health for a ledger it\n" +
      "never saw, and every number here is about that ledger.",
  );
  process.exit(2);
}

const JSON_OUT = process.argv.includes("--json");

/** Mirrors READ.windowDays in challenge.server.ts — the derivation window. */
const WINDOW_DAYS = 30;

/** Rows, or `null` meaning WE COULD NOT LOOK. Never an empty array for that. */
type Read<T> = { rows: T[]; blocked: false } | { rows: null; blocked: true; why: string };

async function page<T>(table: string, select: string, filter = ""): Promise<Read<T>> {
  const out: T[] = [];
  // Supabase caps `.select()` at 1000 rows and TRUNCATES SILENTLY, so every read
  // here is explicitly paged. A report that quietly stopped at 1000 would be
  // confidently wrong, which is the one thing a metric must never be.
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

interface Call {
  market_id: number;
  caller_wallet: string;
  responder_wallet: string;
  relation_at_call: string;
  called_at: string;
  responded_at: string | null;
}
interface Event {
  wallet: string;
  market_id: string | null;
  kind: string;
  side: string | null;
  /** BUY | SELL. A first-class column `buildChallenges` does not read. */
  action: string | null;
  occurred_at: string;
}
interface Belief {
  wallet: string;
  onchain_id: number;
  /** YES | NO | MIXED | INACTIVE — the canonical CURRENT stance. */
  stance_side: string | null;
}
interface DnaRow {
  viewer_wallet: string;
  twin_matches: unknown;
  tribe_matches: unknown;
  opp_matches: unknown;
  inverse_matches: unknown;
}

const out: string[] = [];
const lc = (v: unknown) => String(v ?? "").toLowerCase();
const pct = (n: number, d: number) => (d > 0 ? (100 * n) / d : 0);
const fmtPct = (v: number) => `${v.toFixed(1)}%`;
const line = (s = "") => out.push(s);
/** 0x1234…ab — enough to identify a wallet in a report, never the whole thing. */
const shortWallet = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;

/** `${a}|${b}` with both sides lowercased — the pair key used throughout. */
const pairKey = (a: string, b: string) => `${lc(a)}|${lc(b)}`;

async function main() {
  const sinceMs = Date.now() - WINDOW_DAYS * 86_400_000;
  const since = new Date(sinceMs).toISOString();

  const [calls, events, beliefs, dna] = await Promise.all([
    page<Call>(
      "market_calls",
      "market_id,caller_wallet,responder_wallet,relation_at_call,called_at,responded_at",
    ),
    page<Event>(
      "events",
      "wallet,market_id,kind,side,action,occurred_at",
      `&is_canonical=eq.true&kind=in.(trade,market_created)&occurred_at=gte.${since}`,
    ),
    page<Belief>("wallet_beliefs", "wallet,onchain_id,stance_side"),
    page<DnaRow>(
      "viewer_dna_cache",
      "viewer_wallet,twin_matches,tribe_matches,opp_matches,inverse_matches",
    ),
  ]);

  const unreadable: string[] = [];
  if (calls.blocked) unreadable.push(`market_calls — ${calls.why}`);
  if (events.blocked) unreadable.push(`events — ${events.why}`);
  if (beliefs.blocked) unreadable.push(`wallet_beliefs — ${beliefs.why}`);
  if (dna.blocked) unreadable.push(`viewer_dna_cache — ${dna.why}`);
  if (unreadable.length > 0) {
    console.error("Could not read:\n  " + unreadable.join("\n  "));
    process.exit(1);
  }

  const CALLS = calls.rows as Call[];
  const EVENTS = events.rows as Event[];
  const BELIEFS = beliefs.rows as Belief[];
  const DNA = dna.rows as DnaRow[];

  /** Every canonical directional trade, keyed wallet|market, earliest first. */
  const tradesBy = new Map<string, Event[]>();
  for (const e of EVENTS) {
    if (e.kind !== "trade") continue;
    const mid = Number(e.market_id);
    if (!Number.isFinite(mid)) continue;
    const k = pairKey(e.wallet, String(mid));
    (tradesBy.get(k) ?? tradesBy.set(k, []).get(k)!).push(e);
  }
  /** Canonical CURRENT stance, keyed wallet|market. */
  const stanceBy = new Map<string, string>();
  for (const b of BELIEFS) stanceBy.set(pairKey(b.wallet, String(b.onchain_id)), lc(b.stance_side));

  line("CHALLENGE INTEGRITY");
  line("===================");
  line(
    `${CALLS.length} calls in the ledger · ${EVENTS.length} canonical events in the last ${WINDOW_DAYS}d`,
  );
  line();

  // ─────────────────────────────────────────────────────────────────────────
  line("1 · ANSWERS NOBODY CAN PROVE");
  line('   "Mike showed up for you" — is there a position behind every one?');
  line();
  {
    const answered = CALLS.filter((c) => c.responded_at);
    let noPosition = 0;
    let beforeCall = 0;
    let proven = 0;
    for (const c of answered) {
      const k = pairKey(c.responder_wallet, String(c.market_id));
      const trades = tradesBy.get(k) ?? [];
      // The window bounds `events`, so a call older than it cannot be judged —
      // counted separately rather than folded in as a failure.
      if (Date.parse(c.called_at) < sinceMs) continue;
      if (trades.length === 0) {
        noPosition += 1;
        continue;
      }
      const calledAt = Date.parse(c.called_at);
      if (trades.every((t) => Date.parse(t.occurred_at) < calledAt)) beforeCall += 1;
      else proven += 1;
    }
    const judged = noPosition + beforeCall + proven;
    line(
      `   ${answered.length} answered calls · ${judged} inside the ${WINDOW_DAYS}d event window`,
    );
    line(`   provable    ${proven}`);
    line(
      `   NO POSITION ${noPosition}${noPosition > 0 ? "   ← stamped without any canonical trade" : ""}`,
    );
    line(
      `   pre-dates   ${beforeCall}${beforeCall > 0 ? "   ← only trades from BEFORE the call" : ""}`,
    );
    if (judged > 0) {
      line(`   unearned share ${fmtPct(pct(noPosition + beforeCall, judged))}`);
    }
    line();
    line("   `answerCalls` is an unsigned POST taking { wallet, marketId } and stamps");
    line("   every matching open row. Any non-zero number above is a claim the product");
    line("   makes about a real person that the ledger cannot substantiate.");
    line();
    line("   NOTE ON THE FIX: verification must not be a bare gate. answerCalls fires");
    line("   when the client's tx confirms, which can precede the indexer writing the");
    line("   event — so a strict check would reject real answers during exactly the");
    line("   window the feature exists for. `pre-dates` and `NO POSITION` above are the");
    line("   two populations a reconciler has to handle differently.");
  }
  line();

  // ─────────────────────────────────────────────────────────────────────────
  line("2 · CALLS NOBODY WAS SHOWN");
  line('   "Surfacing IS the call" — but the server never learns it was seen.');
  line();
  {
    const open = CALLS.filter((c) => !c.responded_at);
    const perResponder = new Map<string, number>();
    for (const c of open) {
      const w = lc(c.responder_wallet);
      perResponder.set(w, (perResponder.get(w) ?? 0) + 1);
    }
    const counts = [...perResponder.values()].sort((a, b) => b - a);
    // The rail renders at most CHALLENGE.maxOpen (6) rows at a time. A responder
    // holding far more than that has rows written across many refetches, and the
    // excess could never have been on screen together.
    const overRail = counts.filter((n) => n > 6).length;
    const excess = counts.reduce((s, n) => s + Math.max(0, n - 6), 0);
    line(`   ${open.length} open calls across ${perResponder.size} responders`);
    line(`   median per responder  ${counts.length ? counts[Math.floor(counts.length / 2)] : 0}`);
    line(`   max per responder     ${counts[0] ?? 0}`);
    line(`   responders over 6     ${overRail}   (the rail never shows more than 6 at once)`);
    line(`   rows beyond a railful ${excess}`);
    line();
    // A call whose originating act has aged out can never be re-derived, so it
    // will never be surfaced again — yet it stays open in the denominator.
    let unsurfaceable = 0;
    for (const c of open) {
      const k = pairKey(c.caller_wallet, String(c.market_id));
      const acts = tradesBy.get(k) ?? [];
      if (acts.length === 0 && Date.parse(c.called_at) < sinceMs) unsurfaceable += 1;
    }
    line(`   UNSURFACEABLE ${unsurfaceable}   open calls whose originating act has aged out`);
    line("   of the derivation window. They can never appear on screen again, and they");
    line("   sit in the showing-up denominator forever.");
  }
  line();

  // ─────────────────────────────────────────────────────────────────────────
  line("3 · CARDS THAT MISSTATE WHAT SOMEBODY BELIEVES");
  line('   "Sarah believes YES" — against the caller\'s CURRENT canonical stance.');
  line();
  {
    const sells = EVENTS.filter((e) => e.kind === "trade" && lc(e.action) === "sell").length;
    const trades = EVENTS.filter((e) => e.kind === "trade").length;
    line(`   ${trades} trade events in window · ${sells} are SELL (${fmtPct(pct(sells, trades))})`);
    line("   `buildChallenges` selects wallet, market_id, kind, side, occurred_at.");
    line("   It never reads `action`, so a SELL of YES is indistinguishable from a BUY.");
    line();
    let agree = 0;
    let contradicts = 0;
    let noStance = 0;
    let notDirectional = 0;
    /** The actual false sentences, so the number has faces attached to it. */
    const examples: string[] = [];
    for (const c of CALLS) {
      const k = pairKey(c.caller_wallet, String(c.market_id));
      const acts = (tradesBy.get(k) ?? [])
        .slice()
        .sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at));
      const latest = acts[0];
      if (!latest || (latest.side !== "YES" && latest.side !== "NO")) continue;
      const stance = stanceBy.get(k);
      if (stance == null) {
        noStance += 1;
        continue;
      }
      const wrong = stance !== lc(latest.side);
      if (stance === "mixed" || stance === "inactive") notDirectional += 1;
      else if (!wrong) agree += 1;
      else contradicts += 1;
      if (wrong && examples.length < 8) {
        examples.push(
          `     market ${c.market_id} · ${shortWallet(lc(c.caller_wallet))} · ` +
            `card says "believes ${latest.side}" · canonical stance ${stance.toUpperCase()}` +
            (lc(latest.action) === "sell" ? " (latest act was a SELL)" : ""),
        );
      }
    }
    const judged = agree + contradicts + notDirectional;
    line(`   ${judged} calls whose caller has both a recent event and a canonical stance`);
    line(`   event side matches stance   ${agree}`);
    line(
      `   CONTRADICTS stance          ${contradicts}${contradicts > 0 ? "   ← card states the opposite side" : ""}`,
    );
    line(
      `   caller is MIXED/INACTIVE    ${notDirectional}${notDirectional > 0 ? "   ← card claims a side they do not hold" : ""}`,
    );
    line(`   no stance row               ${noStance}   (not judged)`);
    if (judged > 0) {
      line(`   wrong-side share ${fmtPct(pct(contradicts + notDirectional, judged))}`);
    }
    if (examples.length > 0) {
      line();
      line("   Cards currently stating the wrong belief:");
      for (const e of examples) line(e);
    }
    line();
    line("   `wallet_beliefs.stance_side` is YES|NO|MIXED|INACTIVE and is already read");
    line("   by buildChallenges for the viewer's own answered set. Sourcing the caller's");
    line("   side from it instead of from whichever event produced the candidate is one");
    line("   extra `.in()` on a query that already runs.");
  }
  line();

  // ─────────────────────────────────────────────────────────────────────────
  line("4 · REACH THAT OVERSTATES THE OPPORTUNITY");
  line('   "Now your people can show up for you. 8 Tribe · 2 Rivals"');
  line();
  {
    /** viewer → qualified counterparties, from the same cache the server reads. */
    const qualified = new Map<string, Set<string>>();
    const take = (viewer: string, rows: unknown) => {
      for (const r of (rows as { wallet?: string | null }[] | null) ?? []) {
        const w = lc(r?.wallet);
        if (w && w !== viewer)
          (qualified.get(viewer) ?? qualified.set(viewer, new Set()).get(viewer)!).add(w);
      }
    };
    for (const d of DNA) {
      const v = lc(d.viewer_wallet);
      take(v, d.twin_matches);
      take(v, d.inverse_matches);
      take(v, d.opp_matches);
      take(v, d.tribe_matches);
    }
    /** Everyone holding a directional position, per market. */
    const inMarket = new Map<string, Set<string>>();
    for (const b of BELIEFS) {
      const s = lc(b.stance_side);
      if (s !== "yes" && s !== "no") continue;
      const m = String(b.onchain_id);
      (inMarket.get(m) ?? inMarket.set(m, new Set()).get(m)!).add(lc(b.wallet));
    }

    // For every wallet that took a directional position, LaunchRail would have
    // printed its reach. Compare that to the people who could actually receive a
    // Challenge for that market.
    let shown = 0;
    let reachable = 0;
    let rows = 0;
    let overstatedRows = 0;
    for (const b of BELIEFS) {
      const s = lc(b.stance_side);
      if (s !== "yes" && s !== "no") continue;
      const v = lc(b.wallet);
      const q = qualified.get(v);
      if (!q || q.size === 0) continue;
      const already = inMarket.get(String(b.onchain_id)) ?? new Set();
      let free = 0;
      for (const w of q) if (!already.has(w)) free += 1;
      rows += 1;
      shown += q.size;
      reachable += free;
      if (free < q.size) overstatedRows += 1;
    }
    line(`   ${rows} positions where a reach number would have been printed`);
    line(`   people the sentence claims  ${shown}`);
    line(`   people who could receive    ${reachable}`);
    line(
      `   OVERSTATED BY               ${shown - reachable}   (${fmtPct(pct(shown - reachable, shown))} of the claim)`,
    );
    line(`   positions with any overstatement ${overstatedRows} of ${rows}`);
    line();
    line("   `callReachFor(wallet)` takes no market id, so it cannot exclude people who");
    line("   already hold a position there. The number is right for a NEWLY CREATED");
    line("   market — nobody can have participated yet — and drifts for every backing");
    line("   of an existing one, which is the common case.");
  }
  line();

  // ─────────────────────────────────────────────────────────────────────────
  line("5 · RELATIONSHIPS ERASED FOR LAYOUT");
  line("   composeChallenges keeps the strongest caller per market. Only that row");
  line("   is persisted, so every other qualifying caller gets no credit.");
  line();
  {
    // Per (responder, market), how many DISTINCT callers are recorded? Today the
    // answer is almost always 1 by construction. The interesting number is how
    // many COULD have qualified — reconstructed the same way the server does.
    const byPair = new Map<string, Set<string>>();
    for (const c of CALLS) {
      const k = pairKey(c.responder_wallet, String(c.market_id));
      (byPair.get(k) ?? byPair.set(k, new Set()).get(k)!).add(lc(c.caller_wallet));
    }
    const multi = [...byPair.values()].filter((s) => s.size > 1).length;
    line(`   ${byPair.size} (responder, market) pairs in the ledger`);
    line(`   with more than one recorded caller  ${multi}`);
    line();

    /** viewer → qualified counterparties (rebuilt; same source as section 4). */
    const qualified = new Map<string, Set<string>>();
    const take = (viewer: string, rows: unknown) => {
      for (const r of (rows as { wallet?: string | null }[] | null) ?? []) {
        const w = lc(r?.wallet);
        if (w && w !== viewer)
          (qualified.get(viewer) ?? qualified.set(viewer, new Set()).get(viewer)!).add(w);
      }
    };
    for (const d of DNA) {
      const v = lc(d.viewer_wallet);
      take(v, d.twin_matches);
      take(v, d.inverse_matches);
      take(v, d.opp_matches);
      take(v, d.tribe_matches);
    }
    /** Who acted in each market inside the window — the candidate pool. */
    const actedIn = new Map<string, Set<string>>();
    for (const e of EVENTS) {
      const mid = String(Number(e.market_id));
      if (mid === "NaN") continue;
      (actedIn.get(mid) ?? actedIn.set(mid, new Set()).get(mid)!).add(lc(e.wallet));
    }

    let pairsWithExtra = 0;
    let extraCallers = 0;
    let totalCausal = 0;
    for (const [k, recorded] of byPair) {
      const [responder, market] = k.split("|");
      const q = qualified.get(responder);
      const actors = actedIn.get(market);
      if (!q || !actors) continue;
      let causal = 0;
      for (const w of actors) if (q.has(w) && w !== responder) causal += 1;
      if (causal === 0) continue;
      totalCausal += causal;
      const extra = causal - recorded.size;
      if (extra > 0) {
        pairsWithExtra += 1;
        extraCallers += extra;
      }
    }
    line(`   causal callers across those pairs   ${totalCausal}`);
    line(`   pairs with an UNCREDITED caller     ${pairsWithExtra}`);
    line(`   RELATIONSHIPS NEVER RECORDED        ${extraCallers}`);
    line();
    line("   Each one is a person who was in a market with somebody they qualify to");
    line("   call, whose card lost the ranking, and who will therefore never see");
    line('   "showed up for you" even though the participation happened.');
    line();
    line("   CAUTION, because this pulls against section 2: recording every causal");
    line("   caller means writing rows for people whose card was never on screen —");
    line("   the exact thing section 2 says must stop. The two only reconcile if the");
    line('   card discloses that the others exist ("Sarah + 2 of your people are');
    line('   here"), which is what makes recording them honest rather than inferred.');
  }
  line();

  // ─────────────────────────────────────────────────────────────────────────
  line("6 · WHAT THE CHALLENGE COUNT ACTUALLY MEANS");
  line("   The badge counts open Challenge MARKETS. The code comment claims");
  line('   "three means three people are actually waiting on you."');
  line();
  {
    const open = CALLS.filter((c) => !c.responded_at);
    const byResponder = new Map<string, Call[]>();
    for (const c of open) {
      const w = lc(c.responder_wallet);
      (byResponder.get(w) ?? byResponder.set(w, []).get(w)!).push(c);
    }
    let divergent = 0;
    let markets = 0;
    let people = 0;
    for (const rows of byResponder.values()) {
      const m = new Set(rows.map((r) => String(r.market_id))).size;
      const p = new Set(rows.map((r) => lc(r.caller_wallet))).size;
      markets += m;
      people += p;
      if (m !== p) divergent += 1;
    }
    line(`   ${byResponder.size} responders with open calls`);
    line(`   open markets  ${markets}`);
    line(`   open callers  ${people}`);
    line(
      `   responders where the two DIFFER  ${divergent}${divergent > 0 ? "   ← the comment is false for these" : ""}`,
    );
    line();
    line("   One person calling you into two markets is two Challenges and one person.");
    line('   The badge should read as "3 open Challenges", which is what it counts.');
  }
  line();

  line("─".repeat(72));
  line("NOT MEASURABLE FROM THE LEDGER, and saying so rather than implying a pass:");
  line();
  line("  · Whether a dismissed (×) call was later answered elsewhere. Dismissal is");
  line("    localStorage-only, so the server has no record to join against. The");
  line("    divergence is real but its size is invisible until it is persisted.");
  line("  · SHOWED UP latency in Now. The synthesis is skipped on delta fetches");
  line("    (live.functions.ts, `data?.since == null`), which is a client-path bug");
  line("    no database query can see. It needs a session trace, not a count.");

  if (JSON_OUT) {
    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), report: out }, null, 2));
  } else {
    console.log(out.join("\n"));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
