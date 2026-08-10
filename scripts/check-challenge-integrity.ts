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
/**
 * THE ONE IMPORT, AND WHY THERE IS ONE AT ALL IN A FILE OF RAW FETCHES.
 *
 * Section 9 checks the reciprocity run against production, and a copy of the
 * algorithm here would be a second answer to "do these two go back and forth" —
 * this report would then be confirming its own copy rather than the code that
 * renders the number on the card. Importing the shipped function is the only
 * version of this check worth running.
 */
import { reciprocity, RECIPROCITY, type PairCall } from "@/domain/dependability";
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
  /**
   * BOTH OF THESE WERE IN THE TABLE AND UNREAD HERE.
   *
   * `passed_at` became durable when a creator started being shown "1 passed", and
   * this report went on describing dismissal as invisible for as long as it was
   * not selected. `challenge_id` is what makes a recipient row belong to a
   * deliberate act, and section 10 exists because nothing was checking that the
   * two tables agree about who a Challenge actually reached.
   */
  passed_at: string | null;
  challenge_id: number | null;
  /** The surrogate handle a child Challenge points at. Null before the migration. */
  id: number | null;
  /** Immutable presentation context. Null on every row stamped before it existed. */
  responded_side: string | null;
}
/** The market-level act. One row per (challenger, market) that went up. */
interface ChallengeRow {
  id: number;
  challenger_wallet: string;
  market_id: number;
  slot_no: number;
  created_at: string;
  closed_at: string | null;
  close_reason: string | null;
  /** Who brought this Challenge's author in. Null is a root. */
  parent_call: number | null;
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
interface Market {
  onchain_id: number;
  title: string | null;
}
/** One entry of a DNA bucket, as `qualifiedCallers` reads it. */
interface CachedRelationship {
  wallet?: string | null;
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

/**
 * What a ledger-dependent section prints when there is no ledger.
 *
 * NOT ZEROS. A section that says "0 unearned answers" over an empty table is
 * indistinguishable from one that checked and found none, and the first
 * production run of this script was read exactly that way.
 */
const noLedger = () => {
  line("   NO DATA — `market_calls` is empty, so this section checked nothing.");
  line("   This is not a pass. See section 0 for whether that is starvation or a");
  line("   broken write path.");
};

async function main() {
  const sinceMs = Date.now() - WINDOW_DAYS * 86_400_000;
  const since = new Date(sinceMs).toISOString();

  const [calls, events, beliefs, dna, markets, challenges] = await Promise.all([
    page<Call>(
      "market_calls",
      "id,market_id,caller_wallet,responder_wallet,relation_at_call,called_at,responded_at,passed_at,challenge_id,responded_side",
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
    // Section 0 needs titles: `buildChallenges` drops a candidate whose market
    // has no title, so a supply count that ignored them would overstate.
    page<Market>("markets", "onchain_id,title"),
    page<ChallengeRow>(
      "challenges",
      "id,challenger_wallet,market_id,slot_no,created_at,closed_at,close_reason,parent_call",
    ),
  ]);

  const unreadable: string[] = [];
  if (calls.blocked) unreadable.push(`market_calls — ${calls.why}`);
  if (events.blocked) unreadable.push(`events — ${events.why}`);
  if (beliefs.blocked) unreadable.push(`wallet_beliefs — ${beliefs.why}`);
  if (dna.blocked) unreadable.push(`viewer_dna_cache — ${dna.why}`);
  if (markets.blocked) unreadable.push(`markets — ${markets.why}`);
  if (challenges.blocked) unreadable.push(`challenges — ${challenges.why}`);
  if (unreadable.length > 0) {
    console.error("Could not read:\n  " + unreadable.join("\n  "));
    process.exit(1);
  }

  const CALLS = calls.rows as Call[];
  const EVENTS = events.rows as Event[];
  const BELIEFS = beliefs.rows as Belief[];
  const DNA = dna.rows as DnaRow[];
  const MARKETS = markets.rows as Market[];
  const CHALLENGES = challenges.rows as ChallengeRow[];

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

  /**
   * Gates every ledger-dependent section below. `scripts/` is NOT in tsconfig's
   * `include`, so this identifier was referenced five times while undeclared and
   * `tsc --noEmit` still passed — the file is never typechecked. Worth knowing
   * before trusting any "tsc clean" claim about anything in this directory.
   */
  const ledgerEmpty = CALLS.length === 0;

  /** viewer → qualified counterparties, from the cache the server reads. */
  const qualified = new Map<string, Set<string>>();
  {
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
  }

  line("CHALLENGE INTEGRITY");
  line("===================");
  line(
    `${CALLS.length} calls in the ledger · ${EVENTS.length} canonical events in the last ${WINDOW_DAYS}d`,
  );
  line();

  // ─────────────────────────────────────────────────────────────────────────
  // SECTION 0 — the question every other section depends on.
  //
  // Sections 1–6 all read `market_calls`. An empty ledger makes every one of
  // them print a clean zero, and a clean zero has two completely different
  // causes that demand opposite responses:
  //
  //   STARVED — the derivation produces nothing, because no viewer has a
  //             qualified caller with a fresh act in an unanswered, titled
  //             market. Nothing is broken; there is simply no supply, and the
  //             nine-item list of fixes is premature.
  //   BROKEN  — supply exists and the ledger is still empty, which means the
  //             surfacing/writing path is not running. Then the list is urgent.
  //
  // This re-derives supply the way `buildChallenges` does — DNA buckets for
  // callers, canonical acts inside the window, minus markets the viewer has
  // already taken a side in, minus untitled markets, one call per market,
  // capped at a railful.
  line("0 · IS THE LEDGER EMPTY BECAUSE IT IS STARVED, OR BECAUSE IT IS BROKEN?");
  line();
  {
    const PEOPLE_PER_BUCKET = 40;
    const MAX_OPEN = 6;

    const titleOf = new Map(
      MARKETS.filter((m) => String(m.title ?? "").trim()).map((m) => [Number(m.onchain_id), true]),
    );

    /** Acts inside the window that could become a call, keyed by wallet. */
    const actsBy = new Map<string, { marketId: number; side: string | null; kind: string }[]>();
    for (const e of EVENTS) {
      const mid = Number(e.market_id);
      if (!Number.isFinite(mid)) continue;
      const w = lc(e.wallet);
      if (!w) continue;
      (actsBy.get(w) ?? actsBy.set(w, []).get(w)!).push({
        marketId: mid,
        side: e.side,
        kind: e.kind,
      });
    }

    /** Markets each viewer has already taken a side in — the exclusion. */
    const answeredBy = new Map<string, Set<number>>();
    for (const b of BELIEFS) {
      const s = String(b.stance_side ?? "").toUpperCase();
      if (s !== "YES" && s !== "NO") continue;
      const w = lc(b.wallet);
      (answeredBy.get(w) ?? answeredBy.set(w, new Set()).get(w)!).add(Number(b.onchain_id));
    }

    const bucketWallets = (row: DnaRow): string[] => {
      const seen = new Set<string>();
      for (const bucket of [
        row.twin_matches,
        row.inverse_matches,
        row.opp_matches,
        row.tribe_matches,
      ]) {
        for (const r of ((bucket as CachedRelationship[] | null) ?? []).slice(
          0,
          PEOPLE_PER_BUCKET,
        )) {
          const w = r?.wallet ? lc(r.wallet) : null;
          if (w) seen.add(w);
        }
      }
      return [...seen];
    };

    let viewersWithCallers = 0;
    let viewersWithSupply = 0;
    let derivable = 0;
    let droppedAnswered = 0;
    let droppedUntitled = 0;
    let droppedNoAct = 0;

    for (const row of DNA) {
      const viewer = lc(row.viewer_wallet);
      const callers = bucketWallets(row).filter((w) => w !== viewer);
      if (callers.length === 0) continue;
      viewersWithCallers += 1;

      const answered = answeredBy.get(viewer) ?? new Set<number>();
      const openMarkets = new Set<number>();
      let sawAnyAct = false;
      for (const caller of callers) {
        for (const a of actsBy.get(caller) ?? []) {
          sawAnyAct = true;
          if (answered.has(a.marketId)) {
            droppedAnswered += 1;
            continue;
          }
          if (!titleOf.has(a.marketId)) {
            droppedUntitled += 1;
            continue;
          }
          // A trade whose side we cannot name is refused by the domain; a
          // creation legitimately has no side.
          if (a.kind === "trade" && a.side !== "YES" && a.side !== "NO") continue;
          openMarkets.add(a.marketId);
        }
      }
      if (!sawAnyAct) droppedNoAct += 1;
      if (openMarkets.size > 0) {
        viewersWithSupply += 1;
        derivable += Math.min(openMarkets.size, MAX_OPEN);
      }
    }

    line(`   ${DNA.length} wallets with a DNA cache row`);
    line(`   with at least one qualified caller  ${viewersWithCallers}`);
    line(`   whose callers acted in the window   ${viewersWithCallers - droppedNoAct}`);
    line(`   with at least one derivable call    ${viewersWithSupply}`);
    line(`   DERIVABLE OPEN CALLS (railful cap)  ${derivable}`);
    line(`   acts dropped — viewer already answered  ${droppedAnswered}`);
    line(`   acts dropped — market has no title      ${droppedUntitled}`);
    line();

    const verdict =
      derivable === 0
        ? "STARVED"
        : CALLS.length === 0
          ? "BROKEN — or never rendered"
          : "SUPPLIED AND WRITING";
    line(`   VERDICT: ${verdict}`);
    line();
    if (verdict === "STARVED") {
      line("   The ledger is empty because the derivation has nothing to write, not");
      line("   because writing fails. Every zero in sections 1, 2, 3, 5 and 6 is a");
      line("   zero about an absent population, and the fixes they describe cannot be");
      line("   validated by this report until supply exists. Section 4 is the one");
      line("   number here measured against real positions rather than the ledger.");
    } else if (verdict.startsWith("BROKEN")) {
      line("   Supply exists and the ledger has nothing in it. THREE causes fit this");
      line("   equally and SQL cannot separate them — the ledger looks identical under");
      line("   all three, which is the actual problem:");
      line();
      line("     a) NEVER RENDERED. `recordCalls` runs only inside `buildChallenges`,");
      line("        which runs only when a qualifying viewer loads the panel. With a");
      line("        population this small that is plausible, and is NOT a bug.");
      line();
      line("     b) THE READ THREW. `buildChallenges` opens with an unguarded");
      line("        `serviceClient()`, and `createClient` throws SYNCHRONOUSLY on a");
      line("        missing key — so a deployment without SUPABASE_SERVICE_ROLE_KEY");
      line("        fails every call. Until the rail learned to say so it rendered");
      line('        "Nobody is waiting on you right now" throughout. CHECK THE DEPLOYED');
      line("        WORKER'S ENV FIRST: it is the cheapest of the three to rule out,");
      line("        and if it is the cause then every other service-role server");
      line("        function is failing the same silent way.");
      line();
      line("     c) THE INSERT FAILED. `recordCalls` is fire-and-forget and swallows");
      line("        23505, so a rejected insert is invisible. Distinguished only by a");
      line("        server log for '[challenge] could not record calls'.");
    } else {
      line("   Supply exists and rows are being written. The sections below are now");
      line("   measuring a real population rather than an empty one.");
    }
  }
  line();

  // ─────────────────────────────────────────────────────────────────────────
  line("1 · ANSWERS NOBODY CAN PROVE");
  line('   "Mike showed up for you" — is there a position behind every one?');
  line();
  if (ledgerEmpty) noLedger();
  else {
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
  if (ledgerEmpty) noLedger();
  else {
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
  if (ledgerEmpty) noLedger();
  else {
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
  if (ledgerEmpty) noLedger();
  else {
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
  if (ledgerEmpty) noLedger();
  else {
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

  // ─────────────────────────────────────────────────────────────────────────
  /**
   * SHARED MARKETS CREATED — the metric Challenge is actually for.
   *
   * Not response agreement. Challenge's job is to MANUFACTURE OVERLAP: Sarah saw
   * a market, she wants to know where John lands, John answers, and now the pair
   * has one more common market than the feed would have given them. Whether they
   * answered the same way is a question for Conviction Match, and a Challenge that
   * produced a disagreement did its job perfectly.
   *
   * DEFINED FROM ANSWERED CALLS, NEVER FROM CO-PARTICIPATION. Two people landing
   * in the same market independently is organic overlap and would flatter this
   * number enormously — measured, 5,706 pairs share at least one market with no
   * Challenge involved anywhere. Only a `market_calls` row with `responded_at` set
   * is overlap Challenge can take credit for.
   */
  line("7 · SHARED MARKETS CREATED BY CHALLENGE");
  line("   The metric Challenge is for — overlap it MANUFACTURED, not overlap that");
  line("   happened. Side-blind by definition: a disagreement counts in full.");
  line();
  if (ledgerEmpty) noLedger();
  else {
    const answered = CALLS.filter((c) => c.responded_at);
    const created = new Set(
      answered.map((c) => pairKey(c.caller_wallet, c.responder_wallet) + `|${c.market_id}`),
    );
    const pairsTouched = new Set(
      answered.map((c) => {
        const a = lc(c.caller_wallet);
        const b = lc(c.responder_wallet);
        return a < b ? `${a}|${b}` : `${b}|${a}`;
      }),
    );
    line(`   SHARED MARKETS CREATED   ${created.size}`);
    line(`   across pairs             ${pairsTouched.size}`);
    line(
      `   per pair                 ${pairsTouched.size ? (created.size / pairsTouched.size).toFixed(2) : "0"}`,
    );
    line();
    // The point of the whole redesign: both outcomes are wins for the metric.
    line("   Agreement is deliberately NOT reported here. It belongs to Conviction");
    line("   Match, which reads these same markets afterwards and asks the different");
    line("   question — when you two see the same world, how often do you see it the");
    line("   same way. Challenge creates the overlap; DNA interprets it.");
  }
  line();

  // ─────────────────────────────────────────────────────────────────────────
  /**
   * SECTION 8 — THE CORPUS. What is actually in the ledger.
   *
   * Every other section falsifies a sentence. This one just counts, because the
   * audit that produced sections 9 and 10 could not: `challenges` and
   * `market_calls` return 200 WITH AN EMPTY ARRAY to the publishable key, so
   * every question about scale was unanswerable outside a service-role run. It
   * is here so that "how big is this" costs one command rather than an argument.
   */
  line("8 · THE CORPUS");
  line("   What the ledger contains. Counts, not claims.");
  line();
  if (ledgerEmpty) noLedger();
  else {
    const answered = CALLS.filter((c) => c.responded_at).length;
    const passed = CALLS.filter((c) => !c.responded_at && c.passed_at).length;
    const waiting = CALLS.length - answered - passed;
    const stale = CALLS.filter(
      (c) => !c.responded_at && !c.passed_at && Date.parse(c.called_at) < sinceMs,
    ).length;
    const orphan = CALLS.filter((c) => c.challenge_id == null).length;

    line(`   calls                    ${CALLS.length}`);
    line(`   answered                 ${answered}  (${fmtPct(pct(answered, CALLS.length))})`);
    line(`   passed                   ${passed}  (${fmtPct(pct(passed, CALLS.length))})`);
    line(`   waiting                  ${waiting}  (${fmtPct(pct(waiting, CALLS.length))})`);
    line(
      `     of those, past ${WINDOW_DAYS}d    ${stale}  — still on the rail, counted in nothing`,
    );
    line(`   pre-V2 (no challenge_id) ${orphan}  — derived rows, belong to no Challenge`);
    line();
    line(`   challenges put up        ${CHALLENGES.length}`);
    line(`     open                   ${CHALLENGES.filter((c) => !c.closed_at).length}`);
    line(
      `     everyone answered      ${CHALLENGES.filter((c) => c.close_reason === "all_responded").length}`,
    );
    line(
      `     taken down             ${CHALLENGES.filter((c) => c.close_reason === "creator").length}`,
    );
    line();

    /**
     * PAIRS, AND THE DISTRIBUTION THAT DECIDES §15.
     *
     * "Alex has taken the same side as you in 4 previous challenges" needs a
     * baseline, and a threshold picked without this table would be a guess. The
     * precedent is `DEPENDABILITY.minForScore = 5`, chosen because the median
     * caller→responder pair shares ONE market. If the shape below looks the same,
     * any expectation copy gated at one or two prior interactions would be the
     * most common sentence on the platform and would mean nothing.
     */
    const perPair = new Map<string, number>();
    for (const c of CALLS) {
      const a = lc(c.caller_wallet);
      const b = lc(c.responder_wallet);
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      perPair.set(k, (perPair.get(k) ?? 0) + 1);
    }
    const bucket = (lo: number, hi: number) =>
      [...perPair.values()].filter((n) => n >= lo && n <= hi).length;
    line(`   person-pairs             ${perPair.size}`);
    line(`     1 interaction          ${bucket(1, 1)}`);
    line(`     2                      ${bucket(2, 2)}`);
    line(`     3–4                    ${bucket(3, 4)}`);
    line(`     5–9                    ${bucket(5, 9)}`);
    line(`     10+                    ${bucket(10, Number.MAX_SAFE_INTEGER)}`);
    line();
    line("   REPEAT market × pair is structurally ZERO and needs no count: the");
    line("   primary key is (market_id, caller_wallet, responder_wallet), so one");
    line("   person cannot call another into the same market twice, ever.");
    line();

    /**
     * SAME SIDE / OPPOSITE — PRINTED HERE AND NOWHERE ELSE, ON PURPOSE.
     *
     * This is the number §14 and §15 want, and the reason they are not built. It
     * is computed from `wallet_beliefs.stance_side`, which is each person's stance
     * TODAY — not the stance they held when they answered. Nothing freezes a side:
     * `market_calls` has no side column, deliberately, because its absence is what
     * guarantees that showing up is never confused with agreeing.
     *
     * So every row below silently rewrites itself whenever anybody flips. It is
     * fine as a one-off measurement in a report somebody is reading knowingly. It
     * would be a lie on a card that said "same side again".
     */
    let same = 0;
    let opposite = 0;
    let unknown = 0;
    for (const c of CALLS) {
      if (!c.responded_at) continue;
      const mine = stanceBy.get(pairKey(c.caller_wallet, String(c.market_id)));
      const theirs = stanceBy.get(pairKey(c.responder_wallet, String(c.market_id)));
      const directional = (s?: string) => s === "yes" || s === "no";
      if (!directional(mine) || !directional(theirs)) unknown += 1;
      else if (mine === theirs) same += 1;
      else opposite += 1;
    }
    line(`   answered calls, same side TODAY      ${same}`);
    line(`   answered calls, opposite TODAY       ${opposite}`);
    line(`   one side not directional today       ${unknown}`);
    line();
    line("   MEASUREMENT ONLY. These read today's stance, not the stance held when");
    line("   the call was answered, so they rewrite themselves whenever anybody");
    line("   flips or exits. No surface may state them — that is why §14/§15 copy");
    line("   is not built, and it stays unbuildable until a side is frozen at");
    line("   answer time the way `relation_at_call` freezes the relationship.");
  }
  line();

  // ─────────────────────────────────────────────────────────────────────────
  /**
   * SECTION 9 — BACK & FORTH, against the shipped function.
   *
   * IT IMPORTS `reciprocity` RATHER THAN REIMPLEMENTING IT. A copy of the
   * algorithm here would be a second answer to "do these two go back and forth",
   * and the two would drift — at which point this report would be confirming its
   * own copy rather than the code that renders the number. What runs below is
   * exactly what produces the line on the card.
   */
  line("9 · BACK & FORTH");
  line("   The run between two people, computed by the function the rail renders.");
  line();
  if (ledgerEmpty) noLedger();
  else {
    /** Every call between one unordered pair, with a stable choice of "viewer". */
    const seqs = new Map<string, PairCall[]>();
    for (const c of CALLS) {
      const a = lc(c.caller_wallet);
      const b = lc(c.responder_wallet);
      // The smaller wallet is the viewer, consistently — `bothWays` is symmetric,
      // so which one is arbitrary, but it must not vary within a pair.
      const [x, y] = a < b ? [a, b] : [b, a];
      const k = `${x}|${y}`;
      const list = seqs.get(k) ?? seqs.set(k, []).get(k)!;
      list.push({
        calledAtMs: Date.parse(c.called_at),
        respondedAtMs: c.responded_at ? Date.parse(c.responded_at) : null,
        passedAtMs: c.passed_at ? Date.parse(c.passed_at) : null,
        // "From the viewer" means the smaller wallet did the asking.
        fromViewer: a === x,
      });
    }

    const runs = [...seqs.entries()].map(([k, calls]) => ({ k, r: reciprocity(calls), calls }));
    const bothWays = runs.filter((x) => x.r.bothWays);
    const printable = bothWays.filter((x) => x.r.run >= RECIPROCITY.minRun);
    line(`   pairs with any call      ${runs.length}`);
    line(`   pairs that go BOTH ways  ${bothWays.length}  (each has answered the other)`);
    line(
      `   pairs a line would show  ${printable.length}  (both ways AND run ≥ ${RECIPROCITY.minRun})`,
    );
    line(`   longest run              ${Math.max(0, ...runs.map((x) => x.r.run))}`);
    line();
    if (printable.length === 0) {
      line("   NOBODY WOULD SEE THE LINE TODAY, and that is a finding rather than a");
      line("   bug: a run needs two people who have each answered the other. The");
      line("   card simply says nothing, which is the designed behaviour at zero.");
    } else {
      line("   REAL SEQUENCES — → is an answer, ✕ a pass, · still waiting:");
      for (const x of printable.sort((p, q) => q.r.run - p.r.run).slice(0, 5)) {
        const [a, b] = x.k.split("|");
        const shape = [...x.calls]
          .sort((p, q) => p.calledAtMs - q.calledAtMs)
          .map((c) =>
            c.respondedAtMs != null ? (c.fromViewer ? "→" : "←") : c.passedAtMs != null ? "✕" : "·",
          )
          .join("");
        line(
          `   ${shortWallet(a)} ${shortWallet(b)}  ${shape}  run ${x.r.run}${
            x.r.endedRun > 0 ? ` (last run of ${x.r.endedRun} ended on a pass)` : ""
          }`,
        );
      }
    }
    line();
    line("   NOTHING HERE READS A SIDE. `PairCall` has no field for one, so a pair");
    line("   who disagree every single time runs exactly as long as a pair who");
    line("   never do — which is the whole point of counting this at all.");
  }
  line();

  // ─────────────────────────────────────────────────────────────────────────
  /**
   * SECTION 10 — SLOT DAMAGE, and it is looking for the fallout of a real bug.
   *
   * `putOnTable` used to write its audience with a multi-row INSERT and swallow
   * 23505. A multi-row INSERT is ATOMIC, and `market_calls`'s primary key has no
   * `closed_at` predicate — so re-issuing a market that had been on the table
   * before collided on every row and rolled the WHOLE audience back. The result
   * is a Challenge that reached nobody: no progress line (`reached: 0` makes it
   * null), never auto-closes (`allResponded` is false at zero by design), and
   * holds one of three editorial slots until its author gives up on it.
   *
   * The write is fixed. THIS COUNTS WHAT THE OLD ONE LEFT BEHIND, because the fix
   * prevents new ones and repairs none of the existing. It deliberately does not
   * clean anything up: closing somebody's Challenge for them is not a decision a
   * diagnostic gets to make.
   */
  line("10 · SLOT DAMAGE");
  line("   Challenges that reached nobody — the fallout of the atomic-insert bug.");
  line();
  if (CHALLENGES.length === 0) {
    line("   NO DATA — nothing has ever been put on the table. Not a pass.");
  } else {
    const reached = new Map<number, number>();
    for (const c of CALLS) {
      if (c.challenge_id == null) continue;
      reached.set(Number(c.challenge_id), (reached.get(Number(c.challenge_id)) ?? 0) + 1);
    }
    const empty = CHALLENGES.filter((c) => (reached.get(Number(c.id)) ?? 0) === 0);
    const emptyOpen = empty.filter((c) => !c.closed_at);
    line(`   challenges that reached nobody   ${empty.length}`);
    line(`     still occupying a slot         ${emptyOpen.length}`);
    for (const c of emptyOpen.slice(0, 8)) {
      line(
        `       ${shortWallet(lc(c.challenger_wallet))} · market ${c.market_id} · up since ${c.created_at.slice(0, 10)}`,
      );
    }
    if (emptyOpen.length > 0) {
      line();
      line("   Each of these is a silent card its author cannot interpret. They are");
      line("   safe to close (`closed_at`, reason `creator`) — every recipient row");
      line("   survives a close, and there are none here to survive. Not done");
      line("   automatically: it is their table.");
    }
    line();

    /** The cap is a partial unique index, so a breach would mean the DB failed. */
    const openPer = new Map<string, number>();
    for (const c of CHALLENGES) {
      if (c.closed_at) continue;
      const w = lc(c.challenger_wallet);
      openPer.set(w, (openPer.get(w) ?? 0) + 1);
    }
    const overCap = [...openPer.entries()].filter(([, n]) => n > 3);
    line(`   anybody over the cap of 3        ${overCap.length}`);
    if (overCap.length > 0) {
      line("   THIS SHOULD BE IMPOSSIBLE. `challenges_active_slot_idx` is a partial");
      line("   unique index on (challenger_wallet, slot_no) WHERE closed_at IS NULL.");
      line("   A breach means the index is missing, not that the cap logic is wrong.");
      for (const [w, n] of overCap.slice(0, 5)) line(`       ${shortWallet(w)} · ${n} open`);
    }

    const openTwice = new Map<string, number>();
    for (const c of CHALLENGES) {
      if (c.closed_at) continue;
      const k = `${lc(c.challenger_wallet)}|${c.market_id}`;
      openTwice.set(k, (openTwice.get(k) ?? 0) + 1);
    }
    const dupes = [...openTwice.values()].filter((n) => n > 1).length;
    line(`   same market up twice at once     ${dupes}`);
    if (dupes > 0) {
      line("   Also index-enforced (`challenges_active_market_idx`). Same conclusion.");
    }
    line();
    line("   RE-ISSUING AFTER A CLOSE IS LEGITIMATE and is not counted as a duplicate:");
    line("   the question genuinely went back up. What the fix changed is that it now");
    line("   reaches the people who never answered plus anybody newly qualified,");
    line("   instead of reaching nobody at all.");
  }
  line();

  // ─────────────────────────────────────────────────────────────────────────
  /**
   * SECTION 11 — THE CHAIN'S SCHEMA, AND WHETHER ITS POINTERS MEAN ANYTHING.
   *
   * The application tolerates all three chain columns being absent: the answer
   * path catches 42703 and stamps without a side, the relay path retries without
   * lineage. That tolerance is right and it is exactly what makes an unapplied
   * migration invisible — nothing crashes, nothing is recorded, and every screen
   * looks healthy. So the columns are proved here rather than inferred from the
   * app not falling over.
   *
   * Then the pointers themselves. A parent that does not exist, points at another
   * market, or names somebody who is not the child's author is not a chain — it
   * is a number in a column, and every "Maya → Sundeep → You" drawn from it would
   * be fiction.
   */
  line("11 · CHAIN INTEGRITY");
  line("   Are the three columns really there, and do the pointers hold up?");
  line();
  {
    const hasId = CALLS.some((c) => c.id != null);
    const sideColumn = CALLS.length > 0 && "responded_side" in (CALLS[0] as object);
    const parentColumn = CHALLENGES.length > 0 && "parent_call" in (CHALLENGES[0] as object);
    line(`   market_calls.id present        ${CALLS.length === 0 ? "NO DATA" : hasId ? "yes" : "NO — migration not applied"}`);
    line(`   market_calls.responded_side    ${CALLS.length === 0 ? "NO DATA" : sideColumn ? "yes" : "NO — migration not applied"}`);
    line(`   challenges.parent_call         ${CHALLENGES.length === 0 ? "NO DATA" : parentColumn ? "yes" : "NO — migration not applied"}`);
    line();

    const answered = CALLS.filter((c) => c.responded_at);
    const answeredNoId = answered.filter((c) => c.id == null).length;
    const badSide = CALLS.filter(
      (c) => c.responded_side != null && c.responded_side !== "YES" && c.responded_side !== "NO",
    ).length;
    const answeredNoSide = answered.filter((c) => c.responded_side == null).length;
    line(`   answered rows                  ${answered.length}`);
    line(`     without an id                ${answeredNoId}  ${answeredNoId ? "← cannot be a lineage parent" : ""}`);
    line(`     with no recorded side        ${answeredNoSide}  (expected on rows stamped before the migration)`);
    line(`   responded_side outside YES/NO  ${badSide}  ${badSide ? "← the CHECK constraint is missing" : ""}`);
    line();

    const callById = new Map<number, Call>();
    for (const c of CALLS) if (c.id != null) callById.set(Number(c.id), c);
    const challengeById = new Map<number, ChallengeRow>();
    for (const c of CHALLENGES) challengeById.set(Number(c.id), c);

    const relayed = CHALLENGES.filter((c) => c.parent_call != null);
    const problems: string[] = [];
    for (const child of relayed) {
      const parent = callById.get(Number(child.parent_call));
      if (!parent) {
        problems.push(`challenge ${child.id} → call ${child.parent_call} does not exist`);
        continue;
      }
      if (Number(parent.market_id) !== Number(child.market_id))
        problems.push(`challenge ${child.id} points at a call in a DIFFERENT market`);
      // The person who answered the parent call must be the person who then put
      // the question up. Anything else is a forged lineage.
      if (lc(parent.responder_wallet) !== lc(child.challenger_wallet))
        problems.push(`challenge ${child.id}'s parent was answered by somebody else`);
      if (!parent.responded_at)
        problems.push(`challenge ${child.id} relays a call nobody answered`);
      if (lc(parent.caller_wallet) === lc(child.challenger_wallet))
        problems.push(`challenge ${child.id} is its own parent's caller — a self-cycle`);
    }
    line(`   challenges with a parent       ${relayed.length}`);
    line(`   lineage problems               ${problems.length}`);
    for (const p of problems.slice(0, 8)) line(`       ${p}`);
    if (relayed.length === 0) {
      line();
      line("   NOBODY HAS RELAYED YET, so the pointer checks proved nothing today.");
      line("   That is a finding about the product's stage, not a clean bill of health.");
    }
  }
  line();

  line("─".repeat(72));
  line("NOT MEASURABLE FROM THE LEDGER, and saying so rather than implying a pass:");
  line();
  line("  · Whether a card waved off with × was later answered anyway. The pass is");
  line("    durable now (`passed_at`, counted in section 8), but the LOCAL hide is");
  line("    still localStorage-only — so a reader who dismissed a card and never");
  line("    reached the market leaves no trace to distinguish from one who did.");
  line("  · What side anybody held AT THE TIME. Nothing freezes it; section 8's");
  line("    same/opposite counts read today's stance and rewrite themselves on every");
  line("    flip. This is the single fact blocking §14/§15, and no query fixes it.");
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
