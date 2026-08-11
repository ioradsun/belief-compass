/**
 * THE MARKETS PAGE — two roles, read once, computed nowhere else.
 *
 * IT CONSUMES CANONICAL STATE AND OWNS NONE OF IT. Challenge lifecycle,
 * recipient counts, showed-up counts, lineage and removal all arrive as
 * `ChallengeCardProjection` from `challengeCardsFor` — the same projection the
 * durable card renders — and are summarised for a row by `domain/markets`.
 * Nothing here recounts a responder or re-derives a state. A market that is
 * `chain_moving` on the Challenge rail is `chain_moving` here, because it is
 * literally the same object.
 *
 * OWNERSHIP IS DECIDED ONCE, FROM AUTHORSHIP. `markets.author_wallet` is the
 * only input, and it produces exactly one section per market — so "created and
 * held appears once, under Market Maker" is a property of this loop rather than
 * a rule two filters have to agree on.
 *
 * WHAT IS NOT SOURCED YET IS NULL, NOT ZERO. `latest` and `earningsUsd` have no
 * canonical reader on this path today; they arrive null and the domain renders
 * silence. A "0 believers" or "no activity" assembled from a read that does not
 * exist would be the confident-zero this codebase keeps paying for, and it would
 * be worse here than absence — the page exists to say what is happening.
 */
import { serviceClient } from "@/lib/supabase-clients";
import { challengeCardsFor } from "@/lib/challenge-card.server";
import type { MarketEntry, Ownership, Participation } from "@/domain/markets";
import type { ChallengeCardProjection } from "@/domain/challenge-card";

/** Bounds. A page of two lists is not a portfolio crawler. */
const READ = { markets: 120, participants: 4000 } as const;

const lc = (v: unknown) => String(v ?? "").toLowerCase();
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export async function marketsFor(viewer: string): Promise<MarketEntry[]> {
  const me = lc(viewer);
  if (!me) return [];
  const sb = serviceClient();

  /**
   * THE TWO WAYS INTO THIS PAGE: a market you wrote, and a market you hold.
   * Read separately because they are different questions, then merged by id —
   * a market that answers both is one entry, and authorship decides its section.
   */
  const [authored, held] = await Promise.all([
    sb
      .from("markets")
      .select("onchain_id, title, first_seen")
      .eq("author_wallet", me)
      .limit(READ.markets),
    sb
      .from("wallet_beliefs")
      .select("onchain_id, yes_shares, no_shares")
      .eq("wallet", me)
      .limit(READ.markets),
  ]);

  // Loudly, then refuse. An empty Markets page for somebody with twelve
  // positions is the confident zero, and here it reads as "you have nothing".
  for (const [label, res] of [["authored", authored] as const, ["held", held] as const])
    if (res.error) {
      console.error(`[markets] ${label} unreadable`, { code: res.error.code });
      throw new Error(res.error.message);
    }

  const authoredRows = (authored.data ?? []) as {
    onchain_id: number;
    title: string | null;
    first_seen: string;
  }[];
  const heldRows = (held.data ?? []) as {
    onchain_id: number;
    yes_shares: number | null;
    no_shares: number | null;
  }[];

  const holdingOf = new Map<number, { yes: number; no: number }>();
  for (const r of heldRows)
    holdingOf.set(Number(r.onchain_id), { yes: num(r.yes_shares), no: num(r.no_shares) });

  const authoredIds = new Set(authoredRows.map((r) => Number(r.onchain_id)));
  const ids = [...new Set([...authoredIds, ...holdingOf.keys()])].slice(0, READ.markets);
  if (ids.length === 0) return [];

  /**
   * TITLES AND PARTICIPATION, plus the canonical Challenge state for every one
   * of these markets. `challengeCardsFor` is bounded and already reads both
   * directions; filtering its output by market is cheaper and — far more
   * importantly — cannot disagree with the Challenge rail.
   */
  const [titles, participants, cards] = await Promise.all([
    sb.from("markets").select("onchain_id, title, first_seen").in("onchain_id", ids),
    sb
      .from("wallet_beliefs")
      .select("onchain_id, stance_side")
      .in("onchain_id", ids)
      .limit(READ.participants),
    challengeCardsFor(me).catch((e: unknown) => {
      /**
       * A FAILED CHALLENGE READ IS NOT "NO CHALLENGE". The page still renders —
       * the roles and the questions are known — and every Challenge summary is
       * absent rather than asserting that nothing is happening.
       */
      console.error("[markets] challenge projections unreadable", { message: String(e) });
      return [] as ChallengeCardProjection[];
    }),
  ]);

  const meta = new Map<number, { title: string | null; firstSeen: string }>();
  for (const r of (titles.data ?? []) as {
    onchain_id: number;
    title: string | null;
    first_seen: string;
  }[])
    meta.set(Number(r.onchain_id), { title: r.title, firstSeen: r.first_seen });

  /**
   * HOW MANY PEOPLE ARE IN THIS QUESTION — directional holders only, because
   * that is what "believer" means. A row with no side is somebody the position
   * engine has processed and who currently backs nothing.
   *
   * Null when the read did not complete: the domain prints nothing rather than
   * "0 believers", which would be a claim about a market nobody counted.
   */
  const counted = !participants.error;
  const tally = new Map<number, { believers: number; yes: number; no: number }>();
  if (counted)
    for (const r of (participants.data ?? []) as {
      onchain_id: number;
      stance_side: string | null;
    }[]) {
      const side = r.stance_side;
      if (side !== "YES" && side !== "NO") continue;
      const id = Number(r.onchain_id);
      const t = tally.get(id) ?? { believers: 0, yes: 0, no: 0 };
      t.believers += 1;
      if (side === "YES") t.yes += 1;
      else t.no += 1;
      tally.set(id, t);
    }

  const cardOf = new Map<number, ChallengeCardProjection>();
  for (const c of cards) cardOf.set(c.marketId, c);

  const out: MarketEntry[] = [];
  for (const marketId of ids) {
    const m = meta.get(marketId);
    const question = m?.title;
    // A market with no title is not renderable as a question, and a card with no
    // question is not a card.
    if (!question) continue;

    const ownership: Ownership = authoredIds.has(marketId) ? "market_maker" : "believer";
    const t = tally.get(marketId);
    const participation: Participation = counted
      ? { believers: t?.believers ?? 0, yes: t?.yes ?? 0, no: t?.no ?? 0 }
      : { believers: null, yes: null, no: null };

    out.push({
      marketId,
      question,
      ownership,
      /**
       * NULL WHEN THERE IS NO ROW, which is different from `{ yes: 0, no: 0 }`.
       * A Market Maker who never backed their own question has no belief row at
       * all; the badge reads "MARKET MAKER" rather than inventing a flat
       * position for them.
       */
      holding: holdingOf.get(marketId) ?? null,
      participation,
      // No canonical reader on this path yet — see the module header.
      latest: null,
      challenge: cardOf.get(marketId) ?? null,
      earningsUsd: null,
      createdAtMs: m?.firstSeen ? Date.parse(m.firstSeen) : 0,
    });
  }
  return out;
}
