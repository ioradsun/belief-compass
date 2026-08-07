/**
 * check-launch — is Launch Mode actually producing participation?
 *
 * SUCCESS IS PARTICIPATION. Not markets created, not invitations sent. Both of
 * those measure how hard people worked, and a product that optimises them ends
 * up with more markets that nobody is in — which is the exact failure this
 * whole effort exists to fix. So the numbers here are joins, backings, and
 * markets that reached a real conversation. Invitations appear only as the
 * denominator the outcomes are read against.
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
 * Run:  npx tsx scripts/check-launch.ts   (npm run check:launch)
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
interface Invite {
  market_id: number;
  to_wallet: string;
  reason_kind: string;
  created_at: string;
  viewed_at: string | null;
  joined_at: string | null;
}
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
  const [states, invites, events] = await Promise.all([
    page<MarketState>("market_state", "onchain_id,directional_believers"),
    page<Invite>(
      "market_invites",
      "market_id,to_wallet,reason_kind,created_at,viewed_at,joined_at",
      "",
      true,
    ),
    page<UserEvent>("user_events", "onchain_id,type,ts", "&type=eq.similar_market_join", true),
  ]);

  const unreadable: string[] = [];
  if (states.blocked) unreadable.push(`market_state — ${states.why}`);
  if (invites.blocked) unreadable.push(`market_invites — ${invites.why}`);
  if (events.blocked) unreadable.push(`user_events — ${events.why}`);

  /* ── 1 · PARTICIPATION — the only success measure ─────────────────────── */

  const believers = (states.rows ?? []).map((s) => Number(s.directional_believers ?? 0));
  const total = believers.length;
  const zero = believers.filter((b) => b === 0).length;
  const fivePlus = believers.filter((b) => b >= CONVERSATION_SIZE).length;
  const zeroPct = pct(zero, total);
  const fivePlusPct = pct(fivePlus, total);

  /* ── 2 · INVITATIONS — outcomes, with sends as the denominator ─────────── */

  const inviteRows = invites.rows ?? [];
  const invitedPairs = inviteRows.map((i) => ({
    market: Number(i.market_id),
    wallet: String(i.to_wallet).toLowerCase(),
  }));
  const invitedMarkets = [...new Set(invitedPairs.map((p) => p.market))];

  // Did the invited person end up holding a side HERE? Read from live positions
  // rather than from the stored stamp, so the report never launders its own
  // bookkeeping — the stamp exists to survive an exit, not to be the evidence.
  const backedKeys = new Set<string>();
  if (invitedMarkets.length > 0) {
    const held = await page<Belief>(
      "wallet_beliefs",
      "wallet,onchain_id",
      `&onchain_id=in.(${invitedMarkets.join(",")})&stance_side=in.(YES,NO)`,
    );
    if (held.blocked) unreadable.push(`wallet_beliefs — ${held.why}`);
    for (const h of held.rows ?? []) {
      backedKeys.add(`${Number(h.onchain_id)}:${String(h.wallet).toLowerCase()}`);
    }
  }

  const sent = inviteRows.length;
  const viewed = inviteRows.filter((i) => !!i.viewed_at).length;
  const joined = inviteRows.filter((i) => !!i.joined_at).length;
  const backed = invitedPairs.filter((p) => backedKeys.has(`${p.market}:${p.wallet}`)).length;

  const byKind = new Map<string, { sent: number; backed: number }>();
  inviteRows.forEach((i, idx) => {
    const k = String(i.reason_kind);
    const cur = byKind.get(k) ?? { sent: 0, backed: 0 };
    cur.sent += 1;
    if (backedKeys.has(`${invitedPairs[idx].market}:${invitedPairs[idx].wallet}`)) cur.backed += 1;
    byKind.set(k, cur);
  });

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
    invitations: {
      blocked: invites.blocked,
      sent,
      viewed,
      joined,
      backed,
      byKind: Object.fromEntries(byKind),
    },
    consolidation: { blocked: events.blocked, diversions, markets: divertedMarkets.size },
  };

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
    const num = (v: string | number, n: number) => String(v).padStart(n);

    console.log("\nLAUNCH — is any of this producing participation?\n");

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

    console.log("\nINVITATIONS  (outcomes — sends are the denominator, never the score)");
    if (invites.blocked) {
      // NOT "0 invitations". A read we were refused and a table that is empty
      // are different facts, and reporting them the same way is how a broken
      // pipeline gets certified as a quiet week.
      console.log("  COULD NOT READ — this section is unknown, not zero.");
    } else if (sent === 0) {
      console.log("  Nothing sent yet. Every number below is waiting on the first invitation.");
    } else {
      console.log(`  sent                     ${num(sent, 8)}`);
      console.log(
        `  viewed                   ${num(viewed, 8)}   ${fmtPct(pct(viewed, sent))} of sent`,
      );
      console.log(
        `  joined                   ${num(joined, 8)}   ${fmtPct(pct(joined, sent))} of sent`,
      );
      console.log(
        `  backed with money        ${num(backed, 8)}   ${fmtPct(pct(backed, sent))} of sent`,
      );
      if (byKind.size > 0) {
        console.log("\n  which audience actually converts");
        for (const [kind, v] of [...byKind].sort((a, b) => b[1].backed - a[1].backed)) {
          console.log(
            `    ${pad(kind, 12)} ${num(v.sent, 5)} sent  ${num(v.backed, 5)} backed  ${fmtPct(pct(v.backed, v.sent))}`,
          );
        }
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
        "  · Whether an invited person joined BECAUSE of the invitation. Arrival is\n" +
        "    observable; persuasion is not.\n" +
        "  · Anyone who never connected a wallet.",
    );
    console.log("");
  }

  /* ── Structural invariants ────────────────────────────────────────────── */

  const problems: string[] = [];
  // Invariants apply only to sections we actually READ. Asserting over a
  // blocked table would turn "no access" into "bug", which is the same
  // category error the report itself refuses to make.
  const checkInvites = !invites.blocked;
  // These are counting bugs, not bad results. `joined` is stamped on first
  // sighting and `backed` is read live, so a joined-count below backed means
  // buildProgress stopped stamping — which would silently flatten the ladder.
  if (checkInvites && viewed > sent) problems.push(`viewed (${viewed}) exceeds sent (${sent})`);
  if (checkInvites && joined > sent) problems.push(`joined (${joined}) exceeds sent (${sent})`);
  if (checkInvites && backed > sent) problems.push(`backed (${backed}) exceeds sent (${sent})`);
  if (checkInvites && sent > 0 && backed > 0 && joined === 0) {
    problems.push("people backed invited markets but nothing was ever stamped joined");
  }
  // The one link with no other symptom: markInviteSeen is called from the shelf
  // on render, so invitations that exist and were never seen by anyone means
  // either nobody opened the app or the call is not firing.
  if (checkInvites && sent > 0 && viewed === 0) {
    problems.push("invitations exist but none has ever been marked viewed — check markInviteSeen");
  }

  if (problems.length > 0) {
    console.error("COUNTING PROBLEMS (these are bugs, not bad numbers):");
    for (const p of problems) console.error(`  ✗ ${p}`);
    console.error("");
    process.exitCode = 1;
  }
}

void main();
