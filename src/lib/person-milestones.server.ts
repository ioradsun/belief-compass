/**
 * PERSON MILESTONES — the read-time projection, mirroring standing facts.
 *
 * No table and no emitter, deliberately, and for a stronger reason than usual:
 * the crossing already has a timestamp. A belief knows when it began, so "when
 * did they reach five convictions?" is the start date of the newest of their
 * five — recoverable from state at any later moment, identically, forever. There
 * is nothing to observe and therefore nothing to persist.
 *
 * WHY SERVICE-ROLE. `wallet_beliefs` is not readable by anon (by design). A
 * missing key costs the milestones, never the page — the same degradation the
 * live tape's tenure lookup and standing facts both use, for the same reason.
 *
 * THE COUNT MUST BE COMPLETE OR IT MUST NOT BE MADE. This reads every belief a
 * person holds, not only the ones in the markets on screen: a count assembled
 * from a visible slice would say "Sarah now backs three questions" to a reader
 * looking at three markets and "five" to a reader looking at five. So the query
 * is by WALLET and unbounded in markets, and a wallet whose rows hit the ceiling
 * is dropped rather than counted short.
 */
import { serviceClientOrNull } from "@/lib/supabase-clients";
import { aliasFor } from "@/lib/wallet-identity";
import { convictionMilestones, type Person, type PersonMilestone } from "@/domain/person-milestone";
import { marketTitleFallback } from "@/domain/market-title";

type Row = Record<string, unknown>;

const num = (v: unknown): number => (v == null || !Number.isFinite(Number(v)) ? 0 : Number(v));

/** How many wallets one pass will look at. Actors on screen, not the world. */
const MAX_WALLETS = 40;

/**
 * Row ceiling for the whole read. A wallet at the ceiling cannot be counted
 * honestly, so the cap is generous enough that hitting it is a signal rather
 * than a routine truncation.
 */
const MAX_ROWS = 2_000;

export interface PersonMilestonesInput {
  /** Wallets that appear in the feed already — the people a reader is meeting. */
  wallets: string[];
  /** Display names, where the caller has resolved them. */
  nameByWallet: Map<string, string>;
  /** Market titles, for naming the belief that took them there. */
  titleById: Map<number, string>;
  /** Only crossings inside this window are news. */
  sinceMs: number;
  nowMs: number;
}

export async function buildPersonMilestones(
  input: PersonMilestonesInput,
): Promise<PersonMilestone[]> {
  const wallets = [...new Set(input.wallets.map((w) => w.toLowerCase()))].slice(0, MAX_WALLETS);
  if (wallets.length === 0) return [];

  const svc = serviceClientOrNull();
  if (!svc) return [];

  const { data, error } = await svc
    .from("wallet_beliefs")
    .select("wallet, onchain_id, yes_shares, no_shares, first_backed_at")
    .in("wallet", wallets)
    .limit(MAX_ROWS);
  if (error || !Array.isArray(data)) return [];

  // TITLES ARE ONE LOOKUP, NOT ONE MAP PER CALLER. The tape hands us the titles
  // it already resolved for the events in its window — a milestone's newest
  // market is often OUTSIDE that window, which is exactly how "The 3rd is
  // “Market #2737”" reached the feed. Anything the caller could not name we
  // name here, through the same shared read.
  const titles = new Map(input.titleById);
  {
    const need = [
      ...new Set(
        (data as Row[])
          .map((r) => Number(r.onchain_id))
          .filter((id) => Number.isFinite(id) && !titles.has(id)),
      ),
    ];
    if (need.length > 0) {
      const { fetchMarketTitles } = await import("@/lib/market-titles.server");
      for (const [id, t] of await fetchMarketTitles(svc, need)) titles.set(id, t);
    }
  }

  const byWallet = new Map<string, Person>();
  const truncated = new Set<string>();
  for (const raw of data as Row[]) {
    const wallet = String(raw.wallet ?? "").toLowerCase();
    if (!wallet) continue;
    // A closed position is not a conviction. Someone who backed ten questions
    // and left eight backs two, and the feed must say two.
    if (num(raw.yes_shares) <= 0 && num(raw.no_shares) <= 0) continue;
    const marketId = Number(raw.onchain_id);
    if (!Number.isFinite(marketId)) continue;

    const person =
      byWallet.get(wallet) ??
      ({
        wallet,
        name: input.nameByWallet.get(wallet) ?? aliasFor(wallet),
        convictions: [],
      } satisfies Person);
    person.convictions.push({
      marketId,
      title: titles.get(marketId) ?? marketTitleFallback(marketId),
      startedAt: (raw.first_backed_at as string | null) ?? null,
    });
    byWallet.set(wallet, person);
  }

  // The ceiling is a truncation, and a truncated wallet has an UNDERCOUNT — the
  // one failure this projection must never ship, because an undercount does not
  // look wrong, it looks like a smaller milestone.
  if ((data as Row[]).length >= MAX_ROWS) {
    for (const w of byWallet.keys()) truncated.add(w);
  }

  return convictionMilestones(
    [...byWallet.values()].filter((p) => !truncated.has(p.wallet)),
    { sinceMs: input.sinceMs, nowMs: input.nowMs },
  );
}
