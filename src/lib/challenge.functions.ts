/**
 * CHALLENGE — the door.
 *
 * Reading your own calls is unsigned: a Challenge panel is the viewer's own view
 * of relationships the DNA engine already computed for them, it grants nothing,
 * and demanding a signature to look at your own home screen would be absurd.
 *
 * Stamping an answer is unsigned for a different reason — it records a fact
 * that is already public on-chain (a position was taken) rather than producing
 * an identity. Nothing here puts one person's name in another's interface, which
 * is the line that forces `verifiedActor` onto a server function — see
 * wallet-authorship.test.ts for the shape that rule exists to prevent.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { CallReach, Challenge, NamedPerson } from "@/domain/challenge";
import type { AudienceResult } from "@/domain/audience";
import type { ChallengeCardProjection } from "@/domain/challenge-card";
import type { ChallengeChainProjection } from "@/domain/challenge-chain";
import type { MarketEntry } from "@/domain/markets";
import type {
  ChainContext,
  ChallengeHistory,
  PairCalls,
  PairSummary,
} from "@/lib/challenge.server";

const WALLET = z.string().min(3).max(80);

/** Open calls: someone you trust took a side and you have not answered. */
export const getChallenges = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) => z.object({ wallet: WALLET.nullish() }).parse(raw ?? {}))
  .handler(async ({ data }): Promise<Challenge[]> => {
    // Signed out there is no "you" for anything to be addressed to, and an empty
    // array is the honest answer rather than a fallback list of popular markets.
    if (!data.wallet) return [];
    const { buildChallenges } = await import("@/lib/challenge.server");
    return buildChallenges(data.wallet);
  });

/**
 * ONE RELATIONSHIP, BOTH DIRECTIONS — what the profile's history reads.
 *
 * Replaces `getAnsweredCalls`, which returned three dismissible notices about one
 * direction. Reading your own relationship with somebody grants nothing and names
 * nobody who is not already on the page, so it stays unsigned.
 */
export const getCallsWithPerson = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) =>
    z.object({ viewer: WALLET.nullish(), person: WALLET }).parse(raw),
  )
  .handler(async ({ data }): Promise<PairCalls | null> => {
    // Signed out there is no relationship to describe — null rather than an empty
    // shape, so the UI renders nothing instead of "no history yet".
    if (!data.viewer) return null;
    const { callsWithPerson } = await import("@/lib/challenge.server");
    return callsWithPerson(data.viewer, data.person);
  });

/**
 * The same counts for a screenful of people — one round trip, not one each.
 *
 * It also carries the reciprocity run now, from the SAME two reads. A second
 * endpoint for "do we go back and forth" would have been a second place where the
 * question is answered, and the two would eventually disagree in front of the same
 * reader on two surfaces.
 */
export const getDependability = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) =>
    z.object({ viewer: WALLET.nullish(), wallets: z.array(WALLET).max(120) }).parse(raw),
  )
  .handler(async ({ data }): Promise<Record<string, PairSummary>> => {
    if (!data.viewer || data.wallets.length === 0) return {};
    const { dependabilityFor } = await import("@/lib/challenge.server");
    return Object.fromEntries(await dependabilityFor(data.viewer, data.wallets));
  });

/**
 * EVERY CHALLENGE EITHER OF US EVER MADE — what "See all" opens.
 *
 * Unsigned for the same reason `getChallenges` is: it is the reader's own history,
 * assembled from rows that already name them, and it grants nothing. The one thing
 * it deliberately cannot return is somebody else's pass — see `challengeHistory`.
 */
export const getChallengeHistory = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) => z.object({ wallet: WALLET.nullish() }).parse(raw ?? {}))
  .handler(async ({ data }): Promise<ChallengeHistory> => {
    if (!data.wallet) return { entries: [], people: {}, truncated: false };
    const { challengeHistory } = await import("@/lib/challenge.server");
    return challengeHistory(data.wallet);
  });

/**
 * How many qualified people this viewer's conviction is eligible to reach.
 * Scoped to a market when one is given, so people already holding a position
 * there are not counted as reachable.
 */
export const getCallReach = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) =>
    z
      .object({ wallet: WALLET.nullish(), marketId: z.number().int().nonnegative().nullish() })
      .parse(raw ?? {}),
  )
  .handler(async ({ data }): Promise<CallReach> => {
    if (!data.wallet) return { tribe: 0, rivals: 0, forming: 0 };
    const { callReachFor } = await import("@/lib/challenge.server");
    return callReachFor(data.wallet, data.marketId ?? undefined);
  });

/**
 * WHO A CHALLENGE WOULD REACH — the faces, before anybody commits.
 *
 * The same `eligibleAudience` the write path calls, which is the entire reason
 * this exists rather than the component assembling a set of its own. Two
 * definitions of who can be asked is how the preview and the write came to
 * disagree by 32 people; a preview that shows faces the write would not contact
 * is that bug with pictures on it.
 *
 * NO SIGNED SESSION. It reads only what the viewer could already see about their
 * own network, writes nothing, and takes no slot — and requiring a signature
 * would put a wallet prompt in front of merely LOOKING at who is around.
 */
export const getAudience = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) =>
    z
      .object({ wallet: WALLET.nullish(), marketId: z.number().int().nonnegative().nullish() })
      .parse(raw ?? {}),
  )
  .handler(async ({ data }): Promise<AudienceResult> => {
    if (!data.wallet || data.marketId == null) return { status: "none" };
    const { audienceFor } = await import("@/lib/challenge.server");
    return audienceFor(data.wallet, data.marketId);
  });

/**
 * "I answered" — close every open call addressed to this wallet in this market.
 *
 * Called after a position is taken. Idempotent by the `responded_at IS NULL`
 * filter, so a re-render or a second trade changes nothing already recorded.
 */
export const answerCalls = createServerFn({ method: "POST" })
  .inputValidator((raw: unknown) =>
    z.object({ wallet: WALLET, marketId: z.number().int().nonnegative() }).parse(raw),
  )
  .handler(
    async ({
      data,
    }): Promise<{ closed: NamedPerson[]; pending: boolean; parentCall: number | null }> => {
      const { markCallsAnswered } = await import("@/lib/challenge.server");
      // WHO this trade just answered, not merely that it succeeded. It is the one
      // moment the product can tell somebody they were counted on, and a bare
      // `{ ok: true }` threw that away at the exact instant it was true.
      // `pending` travels with the result rather than being flattened away: the
      // caller needs to tell "nobody was waiting" from "we could not prove it yet",
      // and those are the same empty array otherwise.
      return markCallsAnswered(data.wallet, data.marketId);
    },
  );

/**
 * HOW EACH QUESTION REACHED YOU — one read for the whole rail.
 *
 * Unsigned like the rest of the reads here: it describes the viewer's own
 * position in chains they are already looking at, and names only people who
 * publicly put a question up or publicly asked somebody.
 */
export const getChainContext = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) =>
    z
      .object({
        wallet: WALLET.nullish(),
        marketIds: z.array(z.number().int().nonnegative()).max(60).default([]),
      })
      .parse(raw ?? {}),
  )
  .handler(async ({ data }): Promise<Record<number, ChainContext>> => {
    if (!data.wallet || data.marketIds.length === 0) return {};
    const { chainContextFor } = await import("@/lib/challenge.server");
    return chainContextFor(data.wallet, data.marketIds);
  });

/**
 * THE LIVING CARDS — one projection per market this viewer has a relationship in.
 *
 * Unsigned for the same reason every other read here is: it is the viewer's own
 * social history, assembled from rows that already name them, and it grants
 * nothing. The one thing it cannot return is somebody else's pass — a passer is
 * counted and never named, and `challengeCardsFor` drops them from `responders`
 * rather than anonymising them.
 */
export const getChallengeCards = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) => z.object({ wallet: WALLET.nullish() }).parse(raw ?? {}))
  .handler(async ({ data }): Promise<ChallengeCardProjection[]> => {
    if (!data.wallet) return [];
    const { challengeCardsFor } = await import("@/lib/challenge-card.server");
    return challengeCardsFor(data.wallet);
  });

/**
 * HOW ONE QUESTION TRAVELLED — the chain view's only read.
 *
 * Unsigned like every other read here, and safe to be: the projection carries
 * names ONLY for the viewer's own route and their own branch. Everything beyond
 * that is aggregate, so there is nothing in the payload that could identify
 * somebody who was merely asked in a stranger's branch.
 */
export const getChallengeChain = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) =>
    z.object({ wallet: WALLET.nullish(), marketId: z.number().int().nonnegative() }).parse(raw),
  )
  .handler(async ({ data }): Promise<ChallengeChainProjection | null> => {
    if (!data.wallet) return null;
    const { challengeChainFor } = await import("@/lib/challenge-chain.server");
    return challengeChainFor(data.wallet, data.marketId);
  });

/**
 * THE MARKETS PAGE — the questions this viewer owns, and the ones they hold.
 *
 * Unsigned like the other reads here: it describes the viewer's own two roles,
 * and the Challenge state it carries is the same projection the durable card
 * already shows them. Nothing in the payload names anybody the Challenge
 * surface would not.
 */
export const getMarkets = createServerFn({ method: "GET" })
  .inputValidator((raw: unknown) => z.object({ wallet: WALLET.nullish() }).parse(raw ?? {}))
  .handler(async ({ data }): Promise<MarketEntry[]> => {
    if (!data.wallet) return [];
    const { marketsFor } = await import("@/lib/markets.server");
    return marketsFor(data.wallet);
  });
