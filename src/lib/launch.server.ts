/**
 * LAUNCH — invitations, and the shelf they arrive on. Server-only.
 *
 * Two jobs, and they are the same job seen from each end: a creator asks
 * specific people to join a specific debate, and those people find out. There
 * is no notification channel on this platform, so "find out" means a row on the
 * For You shelf next time they open the app. That makes this file the whole
 * delivery mechanism, not a convenience over one.
 *
 * WHAT IS AND IS NOT HERE. Composing the shelf's sentences is
 * `@/domain/for-you`, which is pure and holds the one rule that matters — a row
 * may appear only if the system can say why THIS person. This file gathers
 * evidence and writes rows; it decides nothing about what may be shown.
 *
 * EVERY READ IS BOUNDED. `wallet_beliefs`, `profiles`, `follows` and
 * `viewer_dna_cache` are all service-role only, so every path here is a
 * privileged read and none of them may become a graph traversal. Caps are
 * stated as constants rather than buried in `.limit()` calls.
 */
import { serviceClient } from "@/lib/supabase-clients";
import { aliasFor } from "@/lib/wallet-identity";
import { categoryLabel, normalizeCategory } from "@/domain/categories";
import {
  composeForYou,
  type ForYouCandidate,
  type ForYouRow,
  type NamedPerson,
} from "@/domain/for-you";
import {
  composeAudience,
  type AudienceCandidate,
  type AudienceEvidence,
  type AudienceRow,
  type LaunchProgress,
} from "@/domain/launch-audience";

/**
 * Sending limits.
 *
 * The uniqueness constraint already makes a resend idempotent, so these exist
 * for a different failure: a creator blanketing a whole category. The point is
 * not to stop enthusiasm, it is to keep the shelf worth reading — a shelf where
 * every row is from the same person is a shelf people learn to skip.
 */
export const INVITE_LIMITS = {
  /** People one creator may invite to ONE market, ever. */
  perMarket: 25,
  /** People one creator may invite anywhere, per rolling hour. */
  perHour: 50,
  /** Recipients accepted in a single call, before anything is written. */
  perCall: 25,
} as const;

/** Bounds on the shelf's evidence gathering. A shelf is not a feed builder. */
const READ = {
  /** Relationships pulled from each DNA bucket. */
  peoplePerBucket: 40,
  /** Positions read per related person. */
  positionsPerPerson: 60,
  /** Distinct markets any single source may contribute. */
  marketsPerSource: 40,
  /** Invitations shown, newest first. */
  invites: 20,
  /** Similar markets consulted for the Adjacent audience. */
  similarMarkets: 6,
  /** Position rows read across those similar markets. */
  adjacentRows: 400,
  /** Followers offered. */
  followers: 60,
  /** Recent markets sampled for the Category audience. */
  categoryMarkets: 60,
  /** Position rows read across those category markets. */
  categoryRows: 400,
} as const;

export type InviteKind = "adjacent" | "tribe" | "rival" | "category" | "follower";

export interface InviteInput {
  toWallet: string;
  /** Composed by the caller at send time and stored verbatim. */
  reason: string;
  reasonKind: InviteKind;
}

export interface InviteResult {
  /** Rows that now exist because of this call. */
  created: number;
  /** Recipients who already had this invitation — not an error. */
  alreadyInvited: number;
  /** Recipients refused by a cap, so the caller can say so plainly. */
  skippedOverLimit: number;
}

/** jsonb rows in viewer_dna_cache carry more than this; only these are read. */
interface CachedRelationship {
  wallet?: string | null;
  agreement?: number | null;
  sharedBeliefs?: number | null;
  strongestAlignedDomain?: { name?: string | null } | null;
}

function walletsOf(rows: unknown, cap: number): string[] {
  return ((rows as CachedRelationship[] | null) ?? [])
    .map((r) => (r?.wallet ? String(r.wallet).toLowerCase() : null))
    .filter((w): w is string => !!w)
    .slice(0, cap);
}

/**
 * Write invitations for one market.
 *
 * IDEMPOTENT, and by the table's own constraint rather than one this branch
 * added. `market_invites_pending_unique` covers (inviter, invitee, onchain_id)
 * WHERE status = 'pending', so a resend, a double-click, a refresh and a retry
 * all resolve to one PENDING row — while a genuine re-invite after a decline,
 * an expiry or a revoke is still allowed, which a stricter constraint would
 * have forbidden.
 *
 * The caller must have PROVEN `fromWallet`. An invitation carries one person's
 * name into another person's interface; see verifiedActor in
 * welcomes.functions.ts for why a claimed wallet is not good enough.
 */
export async function writeInvites(
  fromWallet: string,
  marketId: number,
  invites: readonly InviteInput[],
): Promise<InviteResult> {
  const from = fromWallet.toLowerCase();
  const sb = serviceClient();

  // Deduplicate and drop self-invites before any counting, so a caller cannot
  // spend their hourly budget on rows the database would reject anyway.
  const byRecipient = new Map<string, InviteInput>();
  for (const i of invites.slice(0, INVITE_LIMITS.perCall)) {
    const to = i.toWallet.trim().toLowerCase();
    const reason = i.reason.trim();
    if (!to || to === from || !reason) continue;
    if (!byRecipient.has(to)) byRecipient.set(to, { ...i, toWallet: to, reason });
  }
  const wanted = [...byRecipient.values()];
  if (wanted.length === 0) {
    return { created: 0, alreadyInvited: 0, skippedOverLimit: 0 };
  }

  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const [existing, marketCount, hourCount] = await Promise.all([
    sb
      .from("market_invites")
      .select("invitee_wallet")
      .eq("onchain_id", marketId)
      .eq("inviter_wallet", from)
      .in(
        "invitee_wallet",
        wanted.map((i) => i.toWallet),
      ),
    sb
      .from("market_invites")
      .select("invitee_wallet", { count: "exact", head: true })
      .eq("onchain_id", marketId)
      .eq("inviter_wallet", from),
    sb
      .from("market_invites")
      .select("invitee_wallet", { count: "exact", head: true })
      .eq("inviter_wallet", from)
      .gte("created_at", hourAgo),
  ]);

  const already = new Set(
    ((existing.data ?? []) as { invitee_wallet: string }[]).map((r) =>
      String(r.invitee_wallet).toLowerCase(),
    ),
  );
  const fresh = wanted.filter((i) => !already.has(i.toWallet));

  // Budgets are measured against what ALREADY exists, so a repeat send can
  // never consume any of them — a creator who taps Invite twice is not closer
  // to their cap than one who tapped it once.
  const marketRoom = Math.max(0, INVITE_LIMITS.perMarket - (marketCount.count ?? 0));
  const hourRoom = Math.max(0, INVITE_LIMITS.perHour - (hourCount.count ?? 0));
  const allowed = fresh.slice(0, Math.min(marketRoom, hourRoom));

  if (allowed.length > 0) {
    // PLAIN INSERT, NOT UPSERT, and the reason is the shape of the index.
    //
    // `market_invites_pending_unique` is PARTIAL — (inviter, invitee,
    // onchain_id) WHERE invitee_wallet IS NOT NULL AND status = 'pending'.
    // Postgres cannot infer a partial index from `ON CONFLICT (cols)` unless the
    // predicate is given too, and supabase-js has no way to express one. An
    // upsert here would therefore fail with 42P10 on EVERY send, not just on a
    // collision.
    //
    // So the pre-filter above does the deduplication and the constraint is the
    // backstop for a race. A 23505 is swallowed deliberately: two concurrent
    // identical sends are the same non-event as a double-click, and — more
    // importantly — the loser must NOT overwrite, because the recipient keeps
    // the sentence the sender saw when they first chose them.
    const { error } = await sb.from("market_invites").insert(
      allowed.map((i) => ({
        onchain_id: marketId,
        inviter_wallet: from,
        invitee_wallet: i.toWallet,
        // The shareable handle. Generated here rather than relying on a column
        // default, so the write works whether or not the table has one.
        code: inviteCode(),
        // `side` IS DELIBERATELY NOT SET, and it is right there in the table.
        // Recruitment invites someone INTO a market; it does not tell them
        // which side to take. An invitation pre-loaded with the sender's answer
        // is not a recruitment, it is a solicitation, and it would turn the For
        // You shelf into a place where people are told what to think by
        // whoever got there first. The column is reserved for a real "challenge
        // this side" interaction, where naming a side is the entire point and
        // the recipient knows it. Guarded in invite-reason.test.ts.
        reason: i.reason.slice(0, 300),
        reason_kind: i.reasonKind,
      })),
    );
    // 23505 = unique_violation. Anything else is a real failure and the caller
    // must hear about it rather than being told the send succeeded.
    if (error && error.code !== "23505") throw new Error(error.message);
  }

  return {
    created: allowed.length,
    alreadyInvited: wanted.length - fresh.length,
    skippedOverLimit: fresh.length - allowed.length,
  };
}

/** A shareable handle for one invitation. Not a secret — it identifies, it does
 *  not authorise; every read behind it re-checks who is asking. */
function inviteCode(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** Mark an invitation seen. The first rung of the outcome ladder. */
export async function markInviteViewed(toWallet: string, marketId: number): Promise<void> {
  const sb = serviceClient();
  await sb
    .from("market_invites")
    .update({ viewed_at: new Date().toISOString() })
    .eq("onchain_id", marketId)
    .eq("invitee_wallet", toWallet.toLowerCase())
    // Only the first view is recorded: "when did this reach them" is the fact
    // Launch Progress needs, and overwriting it every load would turn it into
    // "when were they last here", which is a different and less useful thing.
    .is("viewed_at", null);
}

/**
 * THE SHELF. Everything the platform can honestly say is about this viewer.
 *
 * Composition — including which rows are allowed to exist at all — belongs to
 * `composeForYou`. This function's whole job is to arrive there with evidence
 * rather than with markets.
 */
export async function buildForYou(viewer: string): Promise<ForYouRow[]> {
  const me = viewer.toLowerCase();
  const sb = serviceClient();

  const [invites, dna, follows, mine] = await Promise.all([
    sb
      .from("market_invites")
      .select("onchain_id, inviter_wallet, reason, created_at, expires_at, status")
      .eq("invitee_wallet", me)
      // PENDING ONLY. An accepted invitation has already done its job, and a
      // declined or revoked one is a decision somebody made — re-showing any of
      // them would be the shelf arguing with its own reader.
      .eq("status", "pending")
      // Belt and braces on top of `status`: nothing sweeps expired rows to
      // 'expired' on a schedule, so a stale invitation can still read as
      // pending. An expired invitation is not a quieter one, it is a past one.
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order("created_at", { ascending: false })
      .limit(READ.invites),
    sb
      .from("viewer_dna_cache")
      .select("twin_matches, tribe_matches, opp_matches, inverse_matches")
      .eq("viewer_wallet", me)
      .maybeSingle(),
    sb.from("follows").select("followed").eq("follower", me),
    sb
      .from("wallet_beliefs")
      .select("onchain_id, stance_side")
      .eq("wallet", me)
      .in("stance_side", ["YES", "NO"]),
  ]);

  // Markets the viewer is already in. Never recommended — and also the anchor
  // for a Rival challenge, which only means anything on a side you hold.
  const mySide = new Map<number, "YES" | "NO">();
  for (const r of (mine.data ?? []) as { onchain_id: number; stance_side: string }[]) {
    if (r.stance_side === "YES" || r.stance_side === "NO") {
      mySide.set(Number(r.onchain_id), r.stance_side);
    }
  }

  const tribeWallets = [
    ...new Set([
      ...walletsOf(dna.data?.twin_matches, READ.peoplePerBucket),
      ...walletsOf(dna.data?.tribe_matches, READ.peoplePerBucket),
    ]),
  ];
  const rivalWallets = [
    ...new Set([
      ...walletsOf(dna.data?.inverse_matches, READ.peoplePerBucket),
      ...walletsOf(dna.data?.opp_matches, READ.peoplePerBucket),
    ]),
  ];
  const followWallets = [
    ...new Set(
      ((follows.data ?? []) as { followed: string }[]).map((r) => String(r.followed).toLowerCase()),
    ),
  ];

  // The strongest aligned topic per person, so a Tribe sentence can name what
  // the two of you agree about instead of only counting heads.
  const topicOf = new Map<string, string>();
  for (const bucket of [dna.data?.twin_matches, dna.data?.tribe_matches]) {
    for (const r of (bucket as CachedRelationship[] | null) ?? []) {
      const w = r?.wallet ? String(r.wallet).toLowerCase() : null;
      const topic = r?.strongestAlignedDomain?.name?.trim();
      if (w && topic) topicOf.set(w, topic);
    }
  }

  const related = [...new Set([...tribeWallets, ...rivalWallets, ...followWallets])];
  if (invites.data?.length === 0 && related.length === 0) return [];

  // ONE read for every related person's positions. Not one per person: a shelf
  // that issued forty round trips would be a graph traversal with a nicer name.
  const { data: theirPositions } = related.length
    ? await sb
        .from("wallet_beliefs")
        .select("wallet, onchain_id, stance_side, last_trade_at")
        .in("wallet", related)
        .in("stance_side", ["YES", "NO"])
        .limit(related.length * READ.positionsPerPerson)
    : { data: [] as never[] };

  type Pos = {
    wallet: string;
    onchain_id: number;
    stance_side: "YES" | "NO";
    last_trade_at: string | null;
  };
  const positions = ((theirPositions ?? []) as Pos[]).map((r) => ({
    wallet: String(r.wallet).toLowerCase(),
    marketId: Number(r.onchain_id),
    side: r.stance_side,
    atMs: r.last_trade_at ? Date.parse(String(r.last_trade_at)) : Date.now(),
  }));

  const tribeSet = new Set(tribeWallets);
  const rivalSet = new Set(rivalWallets);
  const followSet = new Set(followWallets);

  // Group by market per source. `atMs` is the most recent thing that happened,
  // because a shelf row's age is about the event, not about the relationship.
  interface Group {
    people: string[];
    atMs: number;
    topic: string | null;
  }
  const group = (pred: (p: (typeof positions)[number]) => boolean): Map<number, Group> => {
    const out = new Map<number, Group>();
    for (const p of positions) {
      if (!pred(p)) continue;
      const g = out.get(p.marketId) ?? { people: [], atMs: 0, topic: null };
      if (!g.people.includes(p.wallet)) g.people.push(p.wallet);
      g.atMs = Math.max(g.atMs, Number.isFinite(p.atMs) ? p.atMs : 0);
      g.topic = g.topic ?? topicOf.get(p.wallet) ?? null;
      out.set(p.marketId, g);
    }
    return new Map([...out].slice(0, READ.marketsPerSource));
  };

  const byTribe = group((p) => tribeSet.has(p.wallet) && !mySide.has(p.marketId));
  // A Rival is only a challenge on a side you already hold, and only when they
  // are on the OTHER one. Anything looser is just a person with an opinion.
  const byRival = group((p) => {
    const ours = mySide.get(p.marketId);
    return rivalSet.has(p.wallet) && !!ours && p.side !== ours;
  });
  const byFollowed = group((p) => followSet.has(p.wallet) && !mySide.has(p.marketId));

  // LOUDLY, THEN DEGRADE. A missing column or a blocked table comes back as
  // `data: null` with an error set, and swallowing that turns the entire
  // invitation channel off silently and forever — exactly how the three
  // previous unapplied-migration failures hid. Log, then carry on with the
  // other shelf sources rather than taking the whole shelf down.
  if (invites.error) {
    console.error("[launch] market_invites unreadable — the shelf shows no invitations", {
      code: invites.error.code,
      message: invites.error.message,
    });
  }
  const inviteRows = (
    (invites.data ?? []) as {
      onchain_id: number;
      inviter_wallet: string;
      reason: string | null;
      created_at: string;
    }[]
  )
    .filter((r) => !mySide.has(Number(r.onchain_id)))
    // A row with no stored reason cannot say why THIS person, and there is no
    // fallback string by design. Rows written before `reason` existed stay in
    // the table and simply never claim a justification they do not have.
    .filter((r) => !!r.reason?.trim());

  // Titles and display names, resolved once for everything the shelf might show.
  const marketIds = [
    ...new Set([
      ...inviteRows.map((r) => Number(r.onchain_id)),
      ...byTribe.keys(),
      ...byRival.keys(),
      ...byFollowed.keys(),
    ]),
  ];
  if (marketIds.length === 0) return [];

  const peopleWallets = [
    ...new Set([
      ...inviteRows.map((r) => String(r.inviter_wallet).toLowerCase()),
      ...[...byTribe.values(), ...byRival.values(), ...byFollowed.values()].flatMap(
        (g) => g.people,
      ),
    ]),
  ];

  const { resolveProfiles } = await import("@/lib/profiles.server");
  const [{ data: markets }, profiles] = await Promise.all([
    sb.from("markets").select("onchain_id, title").in("onchain_id", marketIds),
    resolveProfiles(peopleWallets, 0),
  ]);
  const titleOf = new Map(
    ((markets ?? []) as { onchain_id: number; title: string | null }[])
      .filter((m) => m.title)
      .map((m) => [Number(m.onchain_id), String(m.title)]),
  );

  // A wallet with no profile is a person with no NAME, not an unnamed row —
  // `aliasFor` is a stable readable handle, and `for-you` counts rather than
  // names anyone whose `name` is null. Passing the alias keeps the sentence
  // human without inventing an identity.
  const person = (w: string): NamedPerson => ({
    wallet: w,
    name: profiles.get(w)?.displayName?.trim() || aliasFor(w),
  });

  const candidates: ForYouCandidate[] = [];

  // One row per market for invitations, carrying every sender — "Sarah and Ana
  // invited you" is one shelf row, not two.
  const inviteByMarket = new Map<number, { from: string[]; reason: string; atMs: number }>();
  for (const r of inviteRows) {
    const id = Number(r.onchain_id);
    const atMs = Date.parse(String(r.created_at));
    const prev = inviteByMarket.get(id);
    if (prev) {
      prev.from.push(String(r.inviter_wallet).toLowerCase());
      prev.atMs = Math.max(prev.atMs, atMs);
    } else {
      // Rows arrive newest first, so the first reason seen is the most recent —
      // and it is used verbatim, never regenerated.
      inviteByMarket.set(id, {
        from: [String(r.inviter_wallet).toLowerCase()],
        reason: String(r.reason ?? ""),
        atMs,
      });
    }
  }
  for (const [marketId, v] of inviteByMarket) {
    const title = titleOf.get(marketId);
    if (!title) continue;
    candidates.push({
      kind: "invited",
      marketId,
      title,
      atMs: v.atMs,
      reason: v.reason,
      from: v.from.map(person),
    });
  }

  for (const [marketId, g] of byTribe) {
    const title = titleOf.get(marketId);
    if (title) {
      candidates.push({
        kind: "tribe",
        marketId,
        title,
        atMs: g.atMs,
        people: g.people.map(person),
        topic: g.topic,
      });
    }
  }
  for (const [marketId, g] of byRival) {
    const title = titleOf.get(marketId);
    if (title) {
      candidates.push({
        kind: "rival",
        marketId,
        title,
        atMs: g.atMs,
        people: g.people.map(person),
        viewerSide: mySide.get(marketId) ?? null,
      });
    }
  }
  for (const [marketId, g] of byFollowed) {
    const title = titleOf.get(marketId);
    if (title) {
      candidates.push({
        kind: "followed",
        marketId,
        title,
        atMs: g.atMs,
        people: g.people.map(person),
      });
    }
  }

  return composeForYou(candidates, { alreadyIn: new Set(mySide.keys()) });
}

/* ── Recruitment: who should see this debate first ───────────────────────── */

/**
 * The five audiences for one market.
 *
 * NO NEW RETRIEVAL. "Adjacent" means people already holding a position in a
 * market that resembles this one, and finding those markets is the job
 * `findMarketSuggestions` already does — the same keyword pull, the same
 * `textScore`, the same band gate. This asks it about the market's OWN title
 * and reads the participants of whatever comes back. A second similarity
 * implementation would be a second set of answers to one question.
 *
 * Composition — including who may be offered at all — belongs to
 * `@/domain/launch-audience`. This gathers evidence and nothing else.
 */
export async function buildAudience(creator: string, marketId: number): Promise<AudienceRow[]> {
  const me = creator.toLowerCase();
  const sb = serviceClient();

  const { data: market } = await sb
    .from("markets")
    .select("onchain_id, title, category")
    .eq("onchain_id", marketId)
    .maybeSingle();
  if (!market?.title) return composeAudience([], { creator: me });

  const title = String(market.title);
  const slug = normalizeCategory(market.category as string | null);

  const { findMarketSuggestions } = await import("@/lib/market-create.server");
  const [similar, here, invitedRows, dna, followers] = await Promise.all([
    // The market's own question, asked of the one scorer. Its exact self comes
    // back too and is filtered below — cheaper than special-casing the query.
    findMarketSuggestions({ question: title }, READ.similarMarkets),
    sb
      .from("wallet_beliefs")
      .select("wallet")
      .eq("onchain_id", marketId)
      .in("stance_side", ["YES", "NO"]),
    sb
      .from("market_invites")
      .select("invitee_wallet")
      .eq("onchain_id", marketId)
      .eq("inviter_wallet", me),
    sb
      .from("viewer_dna_cache")
      .select("twin_matches, tribe_matches, opp_matches, inverse_matches")
      .eq("viewer_wallet", me)
      .maybeSingle(),
    sb
      .from("follows")
      .select("follower")
      .eq("followed", me)
      .order("created_at", { ascending: false })
      .limit(READ.followers),
  ]);

  const alreadyIn = new Set(
    ((here.data ?? []) as { wallet: string }[]).map((r) => String(r.wallet).toLowerCase()),
  );
  const invited = new Set(
    ((invitedRows.data ?? []) as { invitee_wallet: string }[]).map((r) =>
      String(r.invitee_wallet).toLowerCase(),
    ),
  );

  const similarIds = similar.map((s) => s.onchainId).filter((id) => id !== marketId);
  const titleById = new Map(similar.map((s) => [s.onchainId, s.title]));

  // ADJACENT — holders of the similar markets, capped. This is the only
  // audience with real density (≥1 for 22% of markets, max 43), which is why it
  // leads the panel.
  const { data: adjacentRows } = similarIds.length
    ? await sb
        .from("wallet_beliefs")
        .select("wallet, onchain_id")
        .in("onchain_id", similarIds)
        .in("stance_side", ["YES", "NO"])
        .limit(READ.adjacentRows)
    : { data: [] as never[] };

  const adjacentOf = new Map<string, { count: number; title: string }>();
  for (const r of (adjacentRows ?? []) as { wallet: string; onchain_id: number }[]) {
    const w = String(r.wallet).toLowerCase();
    const t = titleById.get(Number(r.onchain_id));
    if (!t) continue;
    const prev = adjacentOf.get(w);
    // The FIRST similar market is the closest one — `findMarketSuggestions`
    // returns them ranked — so the sentence names the strongest overlap rather
    // than whichever row the database happened to return last.
    adjacentOf.set(w, { count: (prev?.count ?? 0) + 1, title: prev?.title ?? t });
  }

  // CATEGORY — people active in this subject. Real but untargeted: it is the
  // weakest reason on the panel, which is why it sits fourth.
  const categoryOf = new Map<string, number>();
  if (slug && slug !== "other") {
    const { data: sameCategory } = await sb
      .from("markets")
      .select("onchain_id")
      .eq("category", slug)
      .neq("onchain_id", marketId)
      .order("onchain_id", { ascending: false })
      .limit(READ.categoryMarkets);
    const ids = ((sameCategory ?? []) as { onchain_id: number }[]).map((m) => Number(m.onchain_id));
    if (ids.length) {
      const { data: backers } = await sb
        .from("wallet_beliefs")
        .select("wallet")
        .in("onchain_id", ids)
        .in("stance_side", ["YES", "NO"])
        .limit(READ.categoryRows);
      for (const r of (backers ?? []) as { wallet: string }[]) {
        const w = String(r.wallet).toLowerCase();
        categoryOf.set(w, (categoryOf.get(w) ?? 0) + 1);
      }
    }
  }

  const relOf = new Map<string, CachedRelationship>();
  const collect = (rows: unknown) => {
    for (const r of ((rows as CachedRelationship[] | null) ?? []).slice(0, READ.peoplePerBucket)) {
      const w = r?.wallet ? String(r.wallet).toLowerCase() : null;
      if (w) relOf.set(w, r);
    }
  };
  collect(dna.data?.twin_matches);
  collect(dna.data?.tribe_matches);
  const tribeWallets = [...relOf.keys()];
  collect(dna.data?.opp_matches);
  collect(dna.data?.inverse_matches);
  const rivalWallets = [...relOf.keys()].filter((w) => !tribeWallets.includes(w));

  const followerWallets = ((followers.data ?? []) as { follower: string }[]).map((r) =>
    String(r.follower).toLowerCase(),
  );

  const everyone = [
    ...new Set([
      ...adjacentOf.keys(),
      ...tribeWallets,
      ...rivalWallets,
      ...categoryOf.keys(),
      ...followerWallets,
    ]),
  ].filter((w) => w !== me && !alreadyIn.has(w));

  const { resolveProfiles } = await import("@/lib/profiles.server");
  const profiles = await resolveProfiles(everyone, 0);
  const nameOf = (w: string) => profiles.get(w)?.displayName?.trim() || aliasFor(w);

  const candidates: AudienceCandidate[] = [];
  const push = (wallet: string, evidence: AudienceEvidence) => {
    if (!everyone.includes(wallet)) return;
    candidates.push({ wallet, name: nameOf(wallet), evidence, invited: invited.has(wallet) });
  };

  for (const [wallet, a] of adjacentOf) {
    push(wallet, { kind: "adjacent", similarTitle: a.title, similarCount: a.count });
  }
  for (const wallet of tribeWallets) {
    const r = relOf.get(wallet);
    push(wallet, {
      kind: "tribe",
      agreement: r?.agreement ?? null,
      shared: r?.sharedBeliefs ?? null,
      topic: r?.strongestAlignedDomain?.name?.trim() || null,
    });
  }
  for (const wallet of rivalWallets) {
    const r = relOf.get(wallet);
    push(wallet, {
      kind: "rival",
      agreement: r?.agreement ?? null,
      shared: r?.sharedBeliefs ?? null,
    });
  }
  if (slug) {
    const label = categoryLabel(slug);
    for (const [wallet, backed] of categoryOf) {
      if (label) push(wallet, { kind: "category", label, backed });
    }
  }
  for (const wallet of followerWallets) push(wallet, { kind: "follower" });

  return composeAudience(candidates, { creator: me, alreadyIn });
}

/**
 * LAUNCH PROGRESS — what happened to the debate, not what the creator sent.
 *
 * `joined_at` is DERIVED and then persisted the first time it is observed. A
 * position can be exited, and a ladder that recomputed from live positions
 * would let "Joined" go backwards — which is not a thing that can happen to a
 * past event. Recording when we first saw it makes the rung durable without
 * needing a writer on the trade path.
 */
export async function buildProgress(marketId: number): Promise<LaunchProgress> {
  const sb = serviceClient();

  const [invites, state] = await Promise.all([
    sb
      .from("market_invites")
      .select("invitee_wallet, viewed_at, accepted_at")
      .eq("onchain_id", marketId),
    sb
      .from("market_state")
      .select("directional_believers")
      .eq("onchain_id", marketId)
      .maybeSingle(),
  ]);

  const rows = (invites.data ?? []) as {
    invitee_wallet: string;
    viewed_at: string | null;
    // The table's own name for "they took a side". Reused rather than adding a
    // second column meaning the same thing.
    accepted_at: string | null;
  }[];
  const invitedWallets = rows.map((r) => String(r.invitee_wallet).toLowerCase());
  const participants = Number(state.data?.directional_believers ?? 0);

  if (invitedWallets.length === 0) {
    return { invited: 0, viewed: 0, joined: 0, backed: 0, participants };
  }

  // JOINED is any stated side; BACKED is money. They are different rungs
  // because taking a side costs nothing and holding one does — collapsing them
  // would let a market look alive when nobody had committed anything.
  const [expressed, held] = await Promise.all([
    sb
      .from("expressed_beliefs")
      .select("wallet")
      .eq("onchain_id", marketId)
      .in("wallet", invitedWallets),
    sb
      .from("wallet_beliefs")
      .select("wallet")
      .eq("onchain_id", marketId)
      .in("wallet", invitedWallets)
      .in("stance_side", ["YES", "NO"]),
  ]);

  const backedSet = new Set(
    ((held.data ?? []) as { wallet: string }[]).map((r) => String(r.wallet).toLowerCase()),
  );
  const joinedSet = new Set([
    ...backedSet,
    ...((expressed.data ?? []) as { wallet: string }[]).map((r) => String(r.wallet).toLowerCase()),
  ]);

  // Persist the first sighting, so the rung survives an exit. Fire and forget:
  // a failure here costs a stamp, never a number, since the count above is
  // already computed from live evidence.
  const newlyJoined = rows
    .filter((r) => !r.accepted_at && joinedSet.has(String(r.invitee_wallet).toLowerCase()))
    .map((r) => String(r.invitee_wallet).toLowerCase());
  if (newlyJoined.length > 0) {
    void sb
      .from("market_invites")
      // `status` moves with the timestamp. Leaving a row stamped accepted but
      // still 'pending' would keep it on the recipient's shelf forever, since
      // the shelf reads status — two fields describing one fact must not be
      // allowed to disagree.
      .update({ accepted_at: new Date().toISOString(), status: "accepted" })
      .eq("onchain_id", marketId)
      .in("invitee_wallet", newlyJoined)
      .is("accepted_at", null)
      .then(() => undefined);
  }

  return {
    invited: rows.length,
    viewed: rows.filter((r) => !!r.viewed_at).length,
    // An earlier sighting counts even if the position is gone now.
    joined: rows.filter(
      (r) => !!r.accepted_at || joinedSet.has(String(r.invitee_wallet).toLowerCase()),
    ).length,
    backed: backedSet.size,
    participants,
  };
}
