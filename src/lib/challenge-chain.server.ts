/**
 * THE WALK — bounded, cycle-safe, and unwilling to invent a beginning.
 *
 * This is the first real consumer of `challenges.parent_call`, so it is also the
 * first place a corrupt pointer can produce a confident lie. Four things can go
 * wrong with a lineage and each one ends the same way — `truncated: true`, and a
 * route that starts with an ellipsis instead of a name:
 *
 *   THE BOUND     a chain longer than `maxDepth`. Real chains are two to four
 *                 links; anything deeper is either remarkable or a bug, and both
 *                 are better reported than followed forever.
 *   A CYCLE       A points at B points at A. Written only by a bug, and it must
 *                 not hang a page render.
 *   A GAP         the parent call or its Challenge is missing. Nothing deletes
 *                 in this system, so this means the read was bounded or the row
 *                 is genuinely broken — either way, unproven.
 *   A CROSSING    a parent in a DIFFERENT market. That is not this question's
 *                 lineage whatever the pointer says.
 *
 * WHAT IT REFUSES TO FETCH IS THE OTHER HALF OF THE DESIGN. The walk collects
 * NAMES only along the viewer's own route and inside the viewer's own branch.
 * Everything beyond that is counted and discarded — the query never selects a
 * responder wallet from somebody else's branch, so no later change to a
 * component can surface one. People who were merely ASKED, anywhere, did not
 * choose to be visible, and passers are invisible everywhere by a rule older
 * than this file.
 */
import { serviceClient } from "@/lib/supabase-clients";
import { aliasFor } from "@/lib/wallet-identity";
import { recipientState } from "@/domain/table";
import type {
  ChainLink,
  ChallengeChainProjection,
  UpstreamPath,
  ViewerBranch,
  WholeChain,
} from "@/domain/challenge-chain";
import type { CardPerson, CardResponder } from "@/domain/challenge-card";
import type { Side } from "@/domain/post-action";

/**
 * Bounds. A chain view is not a graph crawler.
 *
 * `maxDepth` is 8 against real chains of two to four: generous enough that
 * truncation means something has gone wrong rather than that somebody was
 * popular, and small enough that a cycle costs eight iterations.
 */
const READ = { maxDepth: 8, calls: 2000, challenges: 400 } as const;

interface CallRow {
  id: number | null;
  market_id: number;
  caller_wallet: string;
  responder_wallet: string;
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
  parent_call: number | null;
}

const sideOf = (v: unknown): Side | null => (v === "YES" || v === "NO" ? v : null);
const lc = (v: unknown) => String(v ?? "").toLowerCase();

export async function challengeChainFor(
  viewer: string,
  marketId: number,
): Promise<ChallengeChainProjection | null> {
  const me = lc(viewer);
  if (!me || !Number.isFinite(marketId)) return null;
  const sb = serviceClient();

  /**
   * ONE MARKET, BOTH TABLES. Every Challenge and every call for this question —
   * which is what makes the whole-chain aggregate possible without a second
   * traversal, and what lets the walk verify same-market ancestry locally
   * instead of asking again per hop.
   */
  const [calls, challenges, market] = await Promise.all([
    sb
      .from("market_calls")
      .select(
        "id, market_id, caller_wallet, responder_wallet, called_at, responded_at, responded_side, passed_at, challenge_id",
      )
      .eq("market_id", marketId)
      .limit(READ.calls),
    sb
      .from("challenges")
      .select("id, challenger_wallet, market_id, parent_call")
      .eq("market_id", marketId)
      .limit(READ.challenges),
    sb.from("markets").select("onchain_id, title").eq("onchain_id", marketId).maybeSingle(),
  ]);

  // Loudly, then refuse. A blocked read here must never render as a chain with
  // one link — that is a claim about how far a question travelled, made from a
  // query that never completed.
  for (const [label, res] of [
    ["calls", calls] as const,
    ["challenges", challenges] as const,
    ["market", market] as const,
  ])
    if (res.error) {
      console.error(`[chain] ${label} unreadable`, { code: res.error.code, marketId });
      return null;
    }

  const question = (market.data as { title?: string | null } | null)?.title;
  if (!question) return null;

  const callRows = (calls.data ?? []) as CallRow[];
  const challengeRows = (challenges.data ?? []) as ChallengeRow[];
  /**
   * THE READS ARE BOUNDED, AND HITTING A BOUND IS A PARTIAL ANSWER. An aggregate
   * assembled from a truncated sweep is a floor, and the view says so rather
   * than presenting it as a total.
   */
  const boundedOut = callRows.length >= READ.calls || challengeRows.length >= READ.challenges;

  const callById = new Map<number, CallRow>();
  for (const c of callRows) if (c.id != null) callById.set(Number(c.id), c);
  const challengeById = new Map<number, ChallengeRow>();
  for (const c of challengeRows) challengeById.set(Number(c.id), c);

  /* ── 1 · How it reached you ──────────────────────────────────────────────── */

  /**
   * THE EARLIEST STILL-RELEVANT CALL ADDRESSED TO ME owns the route, and it is
   * the same rule the durable card uses to pick its primary caller — so the
   * person shown as bringing you in on the card is the person the chain starts
   * from. Two rules here would let the visible line and the walked lineage
   * disagree about the same relationship.
   */
  const toMe = callRows
    .filter((c) => lc(c.responder_wallet) === me)
    .sort((a, b) => Date.parse(a.called_at) - Date.parse(b.called_at));
  const entry = toMe.find((c) => !c.passed_at) ?? toMe[0] ?? null;

  const walked = walkUp(entry, callById, challengeById, marketId);

  /* ── 2 · Your branch ─────────────────────────────────────────────────────── */

  const myChallenge = challengeRows.find((c) => lc(c.challenger_wallet) === me) ?? null;
  const myRecipients = myChallenge
    ? callRows.filter((c) => Number(c.challenge_id) === Number(myChallenge.id))
    : [];

  /* ── 3 · The whole chain, as numbers ─────────────────────────────────────── */

  const responderWallets = new Set<string>();
  for (const c of callRows) if (c.responded_at) responderWallets.add(lc(c.responder_wallet));
  const relayerWallets = new Set<string>();
  for (const c of challengeRows)
    if (c.parent_call != null) relayerWallets.add(lc(c.challenger_wallet));

  const wholeChain: WholeChain = {
    uniqueResponders: responderWallets.size,
    uniqueRelayers: relayerWallets.size,
    recipientOpportunities: callRows.length,
    partial: boundedOut || walked.truncated,
  };

  /* ── Names, resolved ONLY for people this viewer is allowed to see ───────── */

  const visible = new Set<string>(walked.wallets);
  for (const r of myRecipients) if (r.responded_at) visible.add(lc(r.responder_wallet));
  for (const c of challengeRows) {
    // A relayer is visible only when they branched off one of MY calls.
    if (c.parent_call == null) continue;
    const parent = callById.get(Number(c.parent_call));
    if (parent && lc(parent.caller_wallet) === me) visible.add(lc(c.challenger_wallet));
  }
  visible.delete(me);

  const { resolveProfiles } = await import("@/lib/profiles.server");
  const profiles = visible.size ? await resolveProfiles([...visible], 0) : new Map();
  const personOf = (wallet: string): CardPerson => ({
    wallet,
    name: profiles.get(wallet)?.displayName?.trim() || aliasFor(wallet),
    avatarUrl: profiles.get(wallet)?.pfpUrl ?? null,
  });

  const upstream: UpstreamPath = {
    path: walked.wallets.map<ChainLink>((w) => ({ person: personOf(w), side: null })),
    // The viewer is not in `path`, and depth counts them.
    depth: walked.wallets.length > 0 ? walked.wallets.length + 1 : 0,
    truncated: walked.truncated,
  };

  const viewerBranch: ViewerBranch | null = myChallenge
    ? buildBranch(myRecipients, challengeRows, callById, me, personOf)
    : null;

  return { marketId, question, upstream, viewerBranch, wholeChain };
}

/**
 * WALK UP FROM THE CALL THAT REACHED ME, and stop honestly at the first thing
 * that cannot be proved.
 *
 * EXPORTED BECAUSE IT IS PURE, and because its four failure modes are the whole
 * risk of this feature. It takes maps rather than a database, so a cycle, a
 * bound, a gap and a market crossing are all expressible as fixtures — and a
 * test that cannot construct a corrupt lineage cannot prove the reader survives
 * one. Nothing outside this module and its test should call it.
 *
 * Returns wallets EARLIEST FIRST, excluding the viewer. `truncated` means the
 * first wallet is the earliest VERIFIED link rather than the origin — the caller
 * must never present it as a root.
 */
export function walkUp(
  entry: CallRow | null,
  callById: ReadonlyMap<number, CallRow>,
  challengeById: ReadonlyMap<number, ChallengeRow>,
  marketId: number,
): { wallets: string[]; truncated: boolean } {
  if (!entry) return { wallets: [], truncated: false };

  const chainUp: string[] = [lc(entry.caller_wallet)];
  const seen = new Set<number>();
  let truncated = false;

  let challenge = entry.challenge_id != null ? challengeById.get(Number(entry.challenge_id)) : null;
  /**
   * A CALL WITH NO CHALLENGE BEHIND IT IS A PRE-V2 ROW. The person who asked is
   * known and provable; what is unknowable is whether anything came before them,
   * so the route is truthful and the origin is not claimed.
   */
  if (!challenge) return { wallets: chainUp, truncated: true };

  for (let hop = 0; hop < READ.maxDepth; hop++) {
    // A CYCLE. Written only by a bug, and it must not hang a render.
    if (seen.has(Number(challenge.id))) return { wallets: chainUp, truncated: true };
    seen.add(Number(challenge.id));

    // A CROSSING. Not this question's lineage, whatever the pointer says.
    if (Number(challenge.market_id) !== marketId) return { wallets: chainUp, truncated: true };

    // A ROOT, PROVED. The person who put it up started it, and nothing above.
    if (challenge.parent_call == null) return { wallets: chainUp, truncated: false };

    // A GAP. Nothing deletes here, so a missing ancestor is bounded read or
    // broken row — unproven either way.
    const parentCall = callById.get(Number(challenge.parent_call));
    if (!parentCall) return { wallets: chainUp, truncated: true };
    if (Number(parentCall.market_id) !== marketId) return { wallets: chainUp, truncated: true };

    chainUp.unshift(lc(parentCall.caller_wallet));

    const next =
      parentCall.challenge_id != null ? challengeById.get(Number(parentCall.challenge_id)) : null;
    if (!next) return { wallets: chainUp, truncated: true };
    challenge = next;
  }

  // THE BOUND. Real chains are two to four links; deeper is remarkable or a bug.
  truncated = true;
  return { wallets: chainUp, truncated };
}

function buildBranch(
  recipients: readonly CallRow[],
  challenges: readonly ChallengeRow[],
  callById: ReadonlyMap<number, CallRow>,
  me: string,
  personOf: (w: string) => CardPerson,
): ViewerBranch {
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
        ...personOf(lc(r.responder_wallet)),
        side: sideOf(r.responded_side),
        atMs: Date.parse(r.responded_at as string),
      });
    } else if (state === "passed") passed += 1;
    else waiting += 1;
  }

  /** Unique PEOPLE who branched off one of my calls — not child rows. */
  const relayers = new Set<string>();
  for (const c of challenges) {
    if (c.parent_call == null) continue;
    const parent = callById.get(Number(c.parent_call));
    if (parent && lc(parent.caller_wallet) === me) relayers.add(lc(c.challenger_wallet));
  }

  return {
    reached: recipients.length,
    showedUp,
    passed,
    waiting,
    responders: responders.sort((a, b) => b.atMs - a.atMs),
    relayers: [...relayers].map(personOf),
  };
}
