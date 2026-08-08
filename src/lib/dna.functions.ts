/**
 * Conviction DNA — public server functions (v1).
 *
 * The API the left-column Network, the center person profile, and the DNA
 * overview read. All scoring/classification is server-owned (src/domain/dna);
 * these functions read the bounded viewer_dna_cache, join display profiles +
 * recent activity, and (for an arbitrary person) compute the exact viewer-person
 * relationship on demand. The client renders this truth and never recomputes it.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { publicClient, serviceClient } from "@/lib/supabase-clients";
import { aliasFor } from "@/lib/wallet-identity";
import { categoryToDomain } from "@/domain/categories";
import { firstBackedIsFloor } from "@/domain/tenure";
import type { PersonPosition, SideChange } from "@/domain/person-profile";
import { NETWORK, type Overlap } from "@/domain/person-network";
import { CIRCLE_MIN_PEOPLE, type EvidenceLevel, type RelationshipLabel } from "@/domain/dna/config";
import { scoreRelationship, type DnaFactor } from "@/domain/dna/score";
import {
  mergeBeliefFactors,
  onChainFactor,
  expressedFactor,
  isDirectional,
  type OnChainBeliefRow,
  type ExpressedBeliefRow,
} from "@/domain/beliefs";
import { classifyRelationship } from "@/domain/dna/classify";
import { scoreDomains, splitDomains } from "@/domain/dna/domains";
import {
  readViewerDnaCache,
  type CachedRelationship,
  type DomainSummary,
  type ViewerDnaCache,
} from "@/lib/dna/viewer-dna-cache.server";
import { marketTitleFallback } from "@/domain/market-title";
import { fetchMarketTitles } from "@/lib/market-titles.server";

type Sb = ReturnType<typeof publicClient>;

// ── shared helpers ───────────────────────────────────────────────────────────

async function resolvePeople(sb: Sb, wallets: string[]) {
  if (wallets.length === 0) return new Map<string, { name: string; avatarUrl: string | null }>();
  const { resolveProfiles } = await import("@/lib/profiles.server");
  const profiles = await resolveProfiles(
    wallets.map((w) => w.toLowerCase()),
    6,
  );
  const out = new Map<string, { name: string; avatarUrl: string | null }>();
  for (const w of wallets) {
    const p = profiles.get(w.toLowerCase());
    out.set(w, { name: p?.displayName ?? aliasFor(w), avatarUrl: p?.pfpUrl ?? null });
  }
  return out;
}

type Activity = {
  marketId: string;
  marketTitle: string;
  side: "YES" | "NO";
  action: string;
  occurredAt: string;
};

/** Most-recent public trade per wallet, with market titles (one query). */
type ActivityRow = {
  wallet: string;
  market_id: string;
  side: string | null;
  action: string | null;
  occurred_at: string;
};

/** Latest canonical trade per wallet — one DB-side row each (DISTINCT ON). */
async function latestActivityByWallet(sb: Sb, wallets: string[]): Promise<Map<string, Activity>> {
  const out = new Map<string, Activity>();
  if (wallets.length === 0) return out;
  const lower = wallets.map((w) => w.toLowerCase());

  // Preferred: the DB returns exactly one (newest) trade per wallet via the
  // (wallet, occurred_at DESC) index — no over-fetch, no client-side dedup.
  let rows: ActivityRow[] | null = null;
  const rpc = await sb.rpc("latest_trade_activity", { p_wallets: lower });
  if (!rpc.error && rpc.data) {
    rows = rpc.data as ActivityRow[];
  } else {
    // Fallback (e.g. before the migration lands): bounded recent scan + dedup.
    const { data } = await sb
      .from("events")
      .select("wallet, market_id, side, action, occurred_at")
      .in("wallet", lower)
      .eq("is_canonical", true)
      .eq("kind", "trade")
      .order("occurred_at", { ascending: false })
      .limit(2000);
    rows = (data ?? []) as ActivityRow[];
  }

  const marketIds = new Set<number>();
  const first = new Map<string, ActivityRow>();
  for (const r of rows) {
    const w = String(r.wallet).toLowerCase();
    if (!first.has(w)) {
      first.set(w, r);
      marketIds.add(Number(r.market_id));
    }
  }
  const titles = await marketTitles(sb, [...marketIds]);
  for (const [w, r] of first) {
    out.set(w, {
      marketId: String(r.market_id),
      marketTitle: titles.get(Number(r.market_id)) ?? marketTitleFallback(r.market_id),
      side: r.side === "NO" ? "NO" : "YES",
      action: r.action ?? "backed",
      occurredAt: r.occurred_at,
    });
  }
  return out;
}

/** Titles come from the one shared lookup — never a second copy of that read. */
async function marketTitles(sb: Sb, ids: number[]): Promise<Map<number, string>> {
  return fetchMarketTitles(sb, ids);
}

/**
 * A viewer's directional beliefs = traded positions (wallet_beliefs) PLUS
 * calibration/expressed answers (expressed_beliefs). A traded position wins
 * when both exist for the same market.
 */
async function loadFactors(sb: Sb, wallet: string): Promise<DnaFactor[]> {
  const w = wallet.toLowerCase();
  const [traded, expressed] = await Promise.all([
    sb
      .from("wallet_beliefs")
      .select("onchain_id, stance_side, conviction")
      .eq("wallet", w)
      .in("stance_side", ["YES", "NO"]),
    sb.from("expressed_beliefs").select("onchain_id, side, weight").eq("wallet", w),
  ]);

  // The SAME mappers and the SAME merge rule the network path uses. This used to
  // be a second inline copy that read a null expressed weight as zero, so a free
  // belief counted for nothing here and 0.15 there — see @/domain/beliefs.
  return mergeBeliefFactors(
    ((traded.data ?? []) as OnChainBeliefRow[]).map(onChainFactor),
    ((expressed.data ?? []) as ExpressedBeliefRow[])
      .filter((r) => isDirectional(r.side))
      .map(expressedFactor),
  );
}

async function expressedBeliefCount(sb: Sb, wallet: string): Promise<number> {
  return (await loadFactors(sb, wallet)).length;
}

// ── /api/me/network ──────────────────────────────────────────────────────────

export type NetworkPersonRow = {
  wallet: string;
  displayName: string;
  avatarUrl: string | null;
  relationship: RelationshipLabel;
  agreement: number;
  sharedBeliefs: number;
  /** Shared markets on the SAME side (together). */
  together: number;
  /** Shared markets on OPPOSITE sides (apart). */
  apart: number;
  /** Distinct belief topics compared (breadth). */
  topicCount: number;
  evidenceLevel: EvidenceLevel;
  strongestAlignedDomain?: DomainSummary;
  strongestOpposedDomain?: DomainSummary;
  latestActivity?: Activity;
};

export type NetworkResponse = {
  summary: {
    expressedBeliefs: number;
    twinCount: number;
    tribeCount: number;
    oppCount: number;
    inverseCount: number;
    strongestAlignedDomain?: string;
    strongestOpposedDomain?: string;
  };
  freshness: { status: "fresh" | "updating" | "stale" | "empty"; calculatedAt?: string };
  people: NetworkPersonRow[];
  nextCursor?: string;
};

const RelFilter = z.enum(["all", "twin", "tribe", "opp", "inverse", "neutral"]);
const Sort = z.enum(["relevant", "closest", "active", "newest"]);

function bucketFor(cache: ViewerDnaCache, filter: z.infer<typeof RelFilter>): CachedRelationship[] {
  switch (filter) {
    case "twin":
      return cache.twin;
    case "tribe":
      return cache.tribe;
    case "opp":
      return cache.opp;
    case "inverse":
      return cache.inverse;
    case "neutral":
      return cache.neutral;
    default: {
      // Strong matches first; then fall back to (and include) closest people so
      // the Network is never empty while the DNA is still forming.
      const strong = [...cache.twin, ...cache.tribe, ...cache.opp, ...cache.inverse];
      const seen = new Set(strong.map((r) => r.wallet.toLowerCase()));
      const closest = cache.closest.filter((r) => !seen.has(r.wallet.toLowerCase()));
      return [...strong, ...closest];
    }
  }
}

/** Most common domain across a set of rows' single strongest aligned/opposed pick. */
function commonDomain(
  rows: CachedRelationship[],
  key: "strongestAlignedDomain" | "strongestOpposedDomain",
) {
  const count = new Map<string, number>();
  for (const r of rows) {
    const d = r[key];
    if (d) count.set(d.name, (count.get(d.name) ?? 0) + 1);
  }
  let best: string | undefined;
  let n = 0;
  for (const [name, c] of count)
    if (c > n) {
      best = name;
      n = c;
    }
  return best;
}

export const getNetwork = createServerFn({ method: "GET" })
  .inputValidator(
    (d: {
      wallet?: string;
      relationship?: z.infer<typeof RelFilter>;
      sort?: z.infer<typeof Sort>;
      query?: string;
      cursor?: string;
      limit?: number;
    }) =>
      z
        .object({
          wallet: z.string().min(3).optional(),
          relationship: RelFilter.optional(),
          sort: Sort.optional(),
          query: z.string().optional(),
          cursor: z.string().optional(),
          limit: z.number().int().min(1).max(60).optional(),
        })
        .parse(d ?? {}),
  )
  .handler(async ({ data }): Promise<NetworkResponse> => {
    const sb = serviceClient();
    const empty: NetworkResponse = {
      summary: { expressedBeliefs: 0, twinCount: 0, tribeCount: 0, oppCount: 0, inverseCount: 0 },
      freshness: { status: "empty" },
      people: [],
    };
    if (!data.wallet) return empty;
    const viewer = data.wallet.toLowerCase();

    const cache = await readViewerDnaCache(sb, viewer);
    const expressedBeliefs = await expressedBeliefCount(sb, viewer);
    if (!cache) {
      // Miss → ask for a bounded background build; render the empty shell.
      try {
        await sb.rpc("request_viewer_match_refresh", { p_wallet: viewer });
      } catch {
        /* best effort */
      }
      return { ...empty, summary: { ...empty.summary, expressedBeliefs } };
    }
    if (!cache.fresh) {
      try {
        await sb.rpc("request_viewer_match_refresh", { p_wallet: viewer });
      } catch {
        /* best effort */
      }
    }

    const filter = data.relationship ?? "all";
    let rows = bucketFor(cache, filter);

    const summary = {
      expressedBeliefs,
      twinCount: cache.twin.length,
      tribeCount: cache.tribe.length,
      oppCount: cache.opp.length,
      inverseCount: cache.inverse.length,
      strongestAlignedDomain: Object.entries(cache.domains).sort(
        (a, b) => b[1].length - a[1].length,
      )[0]?.[0],
      strongestOpposedDomain: commonDomain(
        [...cache.opp, ...cache.inverse],
        "strongestOpposedDomain",
      ),
    };

    // Resolve profiles for the whole (bounded) working set so search can match names.
    const profiles = await resolvePeople(
      sb,
      rows.map((r) => r.wallet),
    );

    // Search across name / wallet / relationship / domain.
    const q = (data.query ?? "").trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) => {
        const p = profiles.get(r.wallet);
        return (
          p?.name.toLowerCase().includes(q) ||
          r.wallet.toLowerCase().includes(q) ||
          r.relationship.includes(q) ||
          r.strongestAlignedDomain?.name.toLowerCase().includes(q) ||
          r.strongestOpposedDomain?.name.toLowerCase().includes(q)
        );
      });
    }

    // Activity (for "active" sort + row lines) over the working set.
    const activity = await latestActivityByWallet(
      sb,
      rows.map((r) => r.wallet),
    );

    const relevanceRank = (r: CachedRelationship) => {
      const w: Record<RelationshipLabel, number> = {
        twin: 5,
        inverse: 4,
        tribe: 3,
        opp: 2,
        neutral: 1,
        insufficient: 0,
      };
      return w[r.relationship] * 1000 + Math.abs(r.agreement - 50) + r.sharedBeliefs / 100;
    };
    const sort = data.sort ?? "relevant";
    rows = [...rows].sort((a, b) => {
      if (sort === "closest") return b.agreement - a.agreement || b.sharedBeliefs - a.sharedBeliefs;
      if (sort === "active") {
        const ta = activity.get(a.wallet)?.occurredAt ?? "";
        const tb = activity.get(b.wallet)?.occurredAt ?? "";
        return tb.localeCompare(ta);
      }
      // relevant + newest (newest has no stored qualified-at yet → relevance order)
      return relevanceRank(b) - relevanceRank(a);
    });

    const limit = data.limit ?? 30;
    const offset = Number(data.cursor ?? "0") || 0;
    const page = rows.slice(offset, offset + limit);
    const nextCursor = offset + limit < rows.length ? String(offset + limit) : undefined;

    const people: NetworkPersonRow[] = page.map((r) => {
      const p = profiles.get(r.wallet);
      return {
        wallet: r.wallet,
        displayName: p?.name ?? aliasFor(r.wallet),
        avatarUrl: p?.avatarUrl ?? null,
        relationship: r.relationship,
        agreement: r.agreement,
        sharedBeliefs: r.sharedBeliefs,
        together: r.sameSideBeliefs ?? 0,
        apart: r.oppositeSideBeliefs ?? 0,
        topicCount: r.topicCount ?? 0,
        evidenceLevel: r.evidenceLevel,
        strongestAlignedDomain: r.strongestAlignedDomain,
        strongestOpposedDomain: r.strongestOpposedDomain,
        latestActivity: activity.get(r.wallet),
      };
    });

    return {
      summary,
      freshness: { status: cache.fresh ? "fresh" : "updating", calculatedAt: cache.calculatedAt },
      people,
      nextCursor,
    };
  });

// ── /api/me/dna ──────────────────────────────────────────────────────────────

export type DnaOverview = {
  connected: boolean;
  expressedBeliefs: number;
  identity: string;
  counts: { twin: number; tribe: number; opp: number; inverse: number };
  closest: NetworkPersonRow[];
  circles: { domain: string; people: number }[];
  divisions: { domain: string; people: number }[];
  freshness: { status: "fresh" | "updating" | "empty"; calculatedAt?: string };
};

function identityLine(circles: { domain: string }[], divisions: { domain: string }[]): string {
  const a = circles.slice(0, 2).map((c) => c.domain);
  const d = divisions.slice(0, 2).map((c) => c.domain);
  const parts: string[] = [];
  if (a.length) parts.push(`You are most aligned with your network on ${a.join(" and ")}.`);
  if (d.length) parts.push(`You are most divided on ${d.join(" and ")}.`);
  return parts.join(" ") || "Your DNA is still forming — express more beliefs to find your people.";
}

export const getDnaOverview = createServerFn({ method: "GET" })
  .inputValidator((d: { wallet?: string }) =>
    z.object({ wallet: z.string().min(3).optional() }).parse(d ?? {}),
  )
  .handler(async ({ data }): Promise<DnaOverview> => {
    const sb = serviceClient();
    const base: DnaOverview = {
      connected: false,
      expressedBeliefs: 0,
      identity: "",
      counts: { twin: 0, tribe: 0, opp: 0, inverse: 0 },
      closest: [],
      circles: [],
      divisions: [],
      freshness: { status: "empty" },
    };
    if (!data.wallet) return base;
    const viewer = data.wallet.toLowerCase();
    const expressedBeliefs = await expressedBeliefCount(sb, viewer);
    const cache = await readViewerDnaCache(sb, viewer);
    if (!cache) {
      try {
        await sb.rpc("request_viewer_match_refresh", { p_wallet: viewer });
      } catch {
        /* best */
      }
      return { ...base, connected: true, expressedBeliefs };
    }

    const circles = Object.entries(cache.domains)
      .map(([domain, members]) => ({ domain, people: members.length }))
      .filter((c) => c.people >= CIRCLE_MIN_PEOPLE)
      .sort((a, b) => b.people - a.people);
    // Divisions: domains where opp/inverse rows most often diverge.
    const divCount = new Map<string, number>();
    for (const r of [...cache.opp, ...cache.inverse]) {
      const d = r.strongestOpposedDomain?.name;
      if (d) divCount.set(d, (divCount.get(d) ?? 0) + 1);
    }
    const divisions = [...divCount.entries()]
      .map(([domain, people]) => ({ domain, people }))
      .filter((d) => d.people >= 1)
      .sort((a, b) => b.people - a.people);

    const closestRows = cache.closest.slice(0, 8);
    const profiles = await resolvePeople(
      sb,
      closestRows.map((r) => r.wallet),
    );
    const closest: NetworkPersonRow[] = closestRows.map((r) => {
      const p = profiles.get(r.wallet);
      return {
        wallet: r.wallet,
        displayName: p?.name ?? aliasFor(r.wallet),
        avatarUrl: p?.avatarUrl ?? null,
        relationship: r.relationship,
        agreement: r.agreement,
        sharedBeliefs: r.sharedBeliefs,
        together: r.sameSideBeliefs ?? 0,
        apart: r.oppositeSideBeliefs ?? 0,
        topicCount: r.topicCount ?? 0,
        evidenceLevel: r.evidenceLevel,
        strongestAlignedDomain: r.strongestAlignedDomain,
        strongestOpposedDomain: r.strongestOpposedDomain,
      };
    });

    return {
      connected: true,
      expressedBeliefs,
      identity: identityLine(circles, divisions),
      counts: {
        twin: cache.twin.length,
        tribe: cache.tribe.length,
        opp: cache.opp.length,
        inverse: cache.inverse.length,
      },
      closest,
      circles,
      divisions,
      freshness: { status: cache.fresh ? "fresh" : "updating", calculatedAt: cache.calculatedAt },
    };
  });

// ── /api/people/:wallet/profile (viewer-relative) ────────────────────────────

export type SharedMarket = {
  marketId: string;
  title: string;
  viewerSide: "YES" | "NO";
  personSide: "YES" | "NO";
  /** Canonical domain, so the receipts can group without a second taxonomy. */
  domain?: string | null;
};

/**
 * Held positions, side changes and holding behaviour — what the profile needs
 * to describe a person through their convictions rather than through a score.
 *
 * One query per fact, all bounded to this wallet. The judgement about which of
 * these reveals the person lives in @/domain/person-profile; this only fetches.
 */
async function loadConvictionEvidence(
  sb: Sb,
  target: string,
  viewer: string | null,
): Promise<{
  positions: PersonPosition[];
  changes: SideChange[];
  personMedianDays: number | null;
  viewerMedianDays: number | null;
  marketsParticipated: number;
  /**
   * How many directional positions they hold in total. Counted rather than
   * derived from `positions.length`, which stops at POSITION_CAP — a page that
   * says "All convictions · 200" about someone holding 260 is lying in the one
   * place that exists to be trusted.
   */
  positionsTotal: number;
}> {
  const [mine, theirs, flips, totalRes] = await Promise.all([
    sb
      .from("wallet_beliefs")
      .select(
        "onchain_id, stance_side, yes_value_usd, no_value_usd, yes_cost, no_cost, days_held, first_backed_at",
      )
      .eq("wallet", target)
      .in("stance_side", ["YES", "NO"])
      .order("days_held", { ascending: false })
      .limit(200),
    viewer
      ? sb
          .from("wallet_beliefs")
          .select("days_held")
          .eq("wallet", viewer)
          .in("stance_side", ["YES", "NO"])
          .limit(200)
      : Promise.resolve({ data: [] as { days_held: number }[] }),
    // A change of mind is a RECORDED event, never inferred from a position that
    // merely closed — someone selling out has not changed their mind, they have
    // left. Newest first: the most recent reversal is the one worth showing.
    //
    // READ THE PAYLOAD, NOT `side`. A transition event is written by
    // emitTransition (src/lib/positions/apply-events.server.ts), which sets the
    // sides in `payload` and leaves the `side` COLUMN null — that column belongs
    // to trade events. This selected `side` and then filtered on it, so the
    // filter discarded every row and this list has been empty in production
    // since it shipped: all 26 stored transitions carry payload sides and none
    // carries a column side. The payload also makes `from` a recorded fact
    // instead of an inversion of `to`.
    sb
      .from("events")
      .select("market_id, payload, occurred_at")
      .eq("wallet", target)
      .eq("kind", "position_changed_side")
      .eq("is_canonical", true)
      .order("occurred_at", { ascending: false })
      .limit(5),
    sb
      .from("wallet_beliefs")
      .select("onchain_id", { count: "exact", head: true })
      .eq("wallet", target)
      .in("stance_side", ["YES", "NO"]),
  ]);

  type BeliefRow = {
    onchain_id: number;
    stance_side: "YES" | "NO";
    yes_value_usd: number | null;
    no_value_usd: number | null;
    yes_cost: number | null;
    no_cost: number | null;
    days_held: number | null;
    first_backed_at: string | null;
  };
  const rows = (mine.data ?? []) as unknown as BeliefRow[];
  const ids = rows.map((r) => Number(r.onchain_id));
  const flipRows = (flips.data ?? []) as unknown as {
    market_id: number;
    payload: { previous_side?: string | null; new_side?: string | null } | null;
    occurred_at: string;
  }[];
  const allIds = [...new Set([...ids, ...flipRows.map((f) => Number(f.market_id))])];

  const [titles, meta, state] = await Promise.all([
    marketTitles(sb, allIds),
    allIds.length
      ? sb.from("markets").select("onchain_id, category, created_at").in("onchain_id", allIds)
      : Promise.resolve({
          data: [] as {
            onchain_id: number;
            category: string | null;
            created_at: string | null;
          }[],
        }),
    ids.length
      ? sb
          .from("market_state")
          .select("onchain_id, people_yes_pct, believers_yes, believers_no")
          .in("onchain_id", ids)
      : Promise.resolve({
          data: [] as {
            onchain_id: number;
            people_yes_pct: number | null;
            believers_yes: number | null;
            believers_no: number | null;
          }[],
        }),
  ]);
  const categoryOf = new Map<number, string | null>();
  const openedAt = new Map<number, number>();
  for (const m of (meta.data ?? []) as {
    onchain_id: number;
    category: string | null;
    created_at: string | null;
  }[]) {
    categoryOf.set(Number(m.onchain_id), m.category);
    const t = m.created_at ? Date.parse(m.created_at) : NaN;
    if (Number.isFinite(t)) openedAt.set(Number(m.onchain_id), t);
  }
  const crowdOf = new Map<number, { yesPct: number | null; participants: number }>();
  for (const m of (state.data ?? []) as {
    onchain_id: number;
    people_yes_pct: number | null;
    believers_yes: number | null;
    believers_no: number | null;
  }[]) {
    crowdOf.set(Number(m.onchain_id), {
      yesPct: m.people_yes_pct == null ? null : Number(m.people_yes_pct),
      participants: (Number(m.believers_yes) || 0) + (Number(m.believers_no) || 0),
    });
  }

  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const positions: PersonPosition[] = rows.map((r) => {
    const id = Number(r.onchain_id);
    const crowd = crowdOf.get(id);
    const days = num(r.days_held);
    // The marked value of the side they actually hold; cost is not a fallback
    // here, because "committed" in the copy means what it is worth now.
    const valueUsd = r.stance_side === "YES" ? r.yes_value_usd : r.no_value_usd;
    const backedMs = r.first_backed_at ? Date.parse(r.first_backed_at) : NaN;
    const isFloor = Number.isFinite(backedMs) ? firstBackedIsFloor(backedMs) : false;
    const opened = openedAt.get(id);
    // HOW LONG AFTER THE MARKET OPENED they arrived — null whenever that cannot
    // be known, which includes every belief that predates the index. A floored
    // start would compute a confident number out of a guess, and "we cannot
    // tell" must never render as evidence of arriving early.
    const daysAfterOpen =
      !isFloor && Number.isFinite(backedMs) && opened != null
        ? Math.max(0, (backedMs - opened) / 86_400_000)
        : null;
    return {
      marketId: id,
      title: titles.get(id) ?? marketTitleFallback(id),
      side: r.stance_side,
      valueUsd: valueUsd == null ? null : Number(valueUsd),
      daysHeld: days,
      tenureIsFloor: isFloor,
      crowdYesPct: crowd?.yesPct ?? null,
      participants: crowd?.participants ?? 0,
      category: categoryOf.get(id) ?? null,
      daysAfterOpen,
    };
  });

  // BOTH sides must be recorded and directional. A transition into or out of
  // MIXED/INACTIVE is not a change of mind, and a row missing either side is a
  // reversal we cannot describe — neither belongs in a list of reversals.
  const changes: SideChange[] = flipRows
    .filter((f) => isDirectional(f.payload?.previous_side) && isDirectional(f.payload?.new_side))
    .map((f) => {
      const id = Number(f.market_id);
      return {
        marketId: id,
        title: titles.get(id) ?? marketTitleFallback(id),
        from: f.payload!.previous_side as "YES" | "NO",
        to: f.payload!.new_side as "YES" | "NO",
        occurredAt: f.occurred_at,
      };
    });

  const median = (xs: number[]): number | null => {
    const v = xs.filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
    if (v.length === 0) return null;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
  };

  return {
    positions,
    changes,
    personMedianDays: median(positions.map((p) => p.daysHeld)),
    viewerMedianDays: median(
      ((theirs.data ?? []) as { days_held: number }[]).map((r) => num(r.days_held)),
    ),
    marketsParticipated: positions.length,
    positionsTotal: Math.max(positions.length, Number(totalRes.count ?? 0)),
  };
}

/**
 * WHO IS STRUCTURALLY CONNECTED TO THIS PERSON — a different question from the
 * one `viewer_dna_cache` answers, and the reason this query exists at all.
 *
 * The cache is viewer-relative: "how is this person connected to ME". Deriving
 * the profile owner's network from it would render the VIEWER's tribe under
 * someone else's name — confident and wrong. So this walks the actual overlap:
 * the markets the owner took a side in, then everyone else who took a side in
 * those same markets.
 *
 * BOUNDED THREE WAYS, because this is the widest read on the profile: the
 * owner's markets are capped, the co-participant rows are capped, and the
 * result is trimmed to the candidates worth describing. A profile page is not
 * allowed to become a graph traversal.
 *
 * The JUDGEMENT — which of these connections is worth showing and how to say
 * it — lives in @/domain/person-network. This only counts.
 */
/**
 * Shared markets carried to the page, per direction.
 *
 * Generous on purpose: the profile now offers "all N shared markets", and a
 * control that expands to a truncated list is worse than no control. Two
 * hundred a side covers every real relationship in production while still
 * bounding the payload.
 */
const SHARED_CAP = 200;

const NETWORK_SCAN = {
  /** Owner markets examined. Their most recent convictions carry the signal. */
  maxMarkets: 60,
  /** Co-participant rows read. Bounds a market with hundreds of believers. */
  maxRows: 4000,
} as const;

async function loadPeopleAround(sb: Sb, target: string): Promise<Overlap[]> {
  const { data: ownRows } = await sb
    .from("wallet_beliefs")
    .select("onchain_id, stance_side, first_backed_at, last_trade_at")
    .eq("wallet", target)
    .in("stance_side", ["YES", "NO"])
    .order("last_trade_at", { ascending: false, nullsFirst: false })
    .limit(NETWORK_SCAN.maxMarkets);
  type Own = {
    onchain_id: number;
    stance_side: "YES" | "NO";
    first_backed_at: string | null;
    last_trade_at: string | null;
  };
  const own = (ownRows ?? []) as unknown as Own[];
  if (own.length === 0) return [];

  const ownById = new Map<number, Own>();
  for (const r of own) ownById.set(Number(r.onchain_id), r);
  const ids = [...ownById.keys()];

  const [{ data: others }, { data: meta }] = await Promise.all([
    sb
      .from("wallet_beliefs")
      .select("wallet, onchain_id, stance_side, first_backed_at, last_trade_at")
      .in("onchain_id", ids)
      .in("stance_side", ["YES", "NO"])
      .neq("wallet", target)
      .limit(NETWORK_SCAN.maxRows),
    sb.from("markets").select("onchain_id, category").in("onchain_id", ids),
  ]);
  const topicOf = new Map<number, string | null>();
  for (const m of (meta ?? []) as { onchain_id: number; category: string | null }[])
    topicOf.set(Number(m.onchain_id), categoryToDomain(m.category));

  type Acc = Omit<Overlap, "name" | "avatarUrl" | "byTopic"> & {
    topics: Map<string, { same: number; opposite: number }>;
    lastMs: number | null;
  };
  const acc = new Map<string, Acc>();
  for (const r of (others ?? []) as unknown as {
    wallet: string;
    onchain_id: number;
    stance_side: "YES" | "NO";
    first_backed_at: string | null;
    last_trade_at: string | null;
  }[]) {
    const w = String(r.wallet).toLowerCase();
    const id = Number(r.onchain_id);
    const mine = ownById.get(id);
    if (!mine) continue;
    const cur =
      acc.get(w) ??
      ({
        wallet: w,
        sharedMarkets: 0,
        sameSide: 0,
        oppositeSide: 0,
        // Both hold a directional side right now — the query already filtered
        // to directional stances, so every shared row IS a live one.
        currentlyTogether: 0,
        daysSinceTogether: null,
        enteredAfter: 0,
        topics: new Map(),
        lastMs: null,
      } satisfies Acc);
    cur.sharedMarkets += 1;
    cur.currentlyTogether += 1;
    const same = r.stance_side === mine.stance_side;
    if (same) cur.sameSide += 1;
    else cur.oppositeSide += 1;

    const topic = topicOf.get(id);
    if (topic) {
      const t = cur.topics.get(topic) ?? { same: 0, opposite: 0 };
      if (same) t.same += 1;
      else t.opposite += 1;
      cur.topics.set(topic, t);
    }

    // Sequence only. Both timestamps must exist — an unknown start proves
    // nothing about who arrived first.
    const theirs = r.first_backed_at ? Date.parse(r.first_backed_at) : NaN;
    const ours = mine.first_backed_at ? Date.parse(mine.first_backed_at) : NaN;
    if (Number.isFinite(theirs) && Number.isFinite(ours) && theirs > ours) cur.enteredAfter += 1;

    const at = r.last_trade_at ? Date.parse(r.last_trade_at) : NaN;
    if (Number.isFinite(at)) cur.lastMs = Math.max(cur.lastMs ?? 0, at);

    acc.set(w, cur);
  }

  // Only candidates the domain module could possibly describe are worth naming.
  const worth = [...acc.values()]
    .filter((a) => a.sharedMarkets >= NETWORK.minShared)
    .sort((a, b) => b.sharedMarkets - a.sharedMarkets)
    .slice(0, 24);
  const profiles = await resolvePeople(
    sb,
    worth.map((a) => a.wallet),
  );
  const now = Date.now();
  return worth.map((a) => ({
    wallet: a.wallet,
    name: profiles.get(a.wallet)?.name ?? aliasFor(a.wallet),
    avatarUrl: profiles.get(a.wallet)?.avatarUrl ?? null,
    sharedMarkets: a.sharedMarkets,
    sameSide: a.sameSide,
    oppositeSide: a.oppositeSide,
    currentlyTogether: a.currentlyTogether,
    daysSinceTogether: a.lastMs == null ? null : Math.max(0, (now - a.lastMs) / 86_400_000),
    byTopic: [...a.topics.entries()].map(([topic, t]) => ({ topic, ...t })),
    enteredAfter: a.enteredAfter,
  }));
}

export type PersonProfile = {
  wallet: string;
  displayName: string;
  avatarUrl: string | null;
  hasViewer: boolean;
  relationship: RelationshipLabel;
  agreement: number;
  sharedBeliefs: number;
  /** Shared markets on the SAME side (together). */
  together: number;
  /** Shared markets on OPPOSITE sides (apart). */
  apart: number;
  /** Distinct belief topics compared (breadth). */
  topicCount: number;
  evidenceLevel: EvidenceLevel;
  summary: string;
  alignedDomains: { domain: string; agreement: number }[];
  opposedDomains: { domain: string; agreement: number }[];
  sharedBoth: SharedMarket[];
  opposing: SharedMarket[];
  recentActivity: Activity[];
  /** Their held positions — what the profile is built FROM, not a list to show. */
  positions: PersonPosition[];
  /** Recorded reversals. Empty when the events log has none. */
  changes: SideChange[];
  /** Median days held, each side, for the holding-behaviour contrast. */
  personMedianDays: number | null;
  viewerMedianDays: number | null;
  /** People structurally connected to THIS person — never the viewer's network. */
  around: Overlap[];
  /**
   * The topics the VIEWER backs most, strongest first.
   *
   * Needed so "What connects you" can find a bond when the two have never met
   * in a market: caring about the same thing is a real connection whether or
   * not it has produced an overlap yet. Empty for a signed-out visitor.
   */
  viewerTopics: string[];
  /** Questions they wrote. Authorship is participation, never a separate role. */
  marketsCreated: number;
  /**
   * Directional positions they hold IN TOTAL — which can exceed
   * `positions.length` when a very active wallet hits the read cap. The "All
   * convictions" heading counts this, never the array it renders.
   */
  positionsTotal: number;
  /**
   * Market ids the VIEWER has taken a side in. Lets the page tell "you have not
   * explored this" from "you two disagree here" — the difference between the
   * two best Start Here reasons. Empty for a signed-out visitor.
   */
  viewerMarketIds: number[];
};

function personSummary(aligned: { domain: string }[], opposed: { domain: string }[]): string {
  const a = aligned.slice(0, 3).map((d) => d.domain);
  const o = opposed.slice(0, 2).map((d) => d.domain);
  const parts: string[] = [];
  if (a.length) parts.push(`You see the world similarly on ${a.join(", ")}.`);
  if (o.length) parts.push(`You differ most on ${o.join(" and ")}.`);
  return parts.join(" ") || "Not enough shared beliefs yet to read this relationship.";
}

export const getPersonProfile = createServerFn({ method: "GET" })
  .inputValidator((d: { wallet: string; viewer?: string }) =>
    z.object({ wallet: z.string().min(3), viewer: z.string().min(3).optional() }).parse(d),
  )
  .handler(async ({ data }): Promise<PersonProfile> => {
    const sb = serviceClient();
    const target = data.wallet.toLowerCase();
    const viewer = data.viewer?.toLowerCase() ?? null;

    const profiles = await resolvePeople(sb, [target]);
    const prof = profiles.get(target);

    const [targetFactors, viewerFactors] = await Promise.all([
      loadFactors(sb, target),
      viewer ? loadFactors(sb, viewer) : Promise.resolve([] as DnaFactor[]),
    ]);

    // Recent public activity (always available).
    const act = await latestActivityByWallet(sb, [target]);
    const single = act.get(target);
    const recentActivity = single ? [single] : [];

    // The convictions themselves. Loaded whether or not a viewer is present:
    // "who is this person" is answerable without knowing who is asking, and a
    // signed-out visitor deserves the same introduction.
    // Both are about the PROFILE OWNER, so both run whether or not a viewer is
    // present — "who is this person and who is around them" is answerable
    // without knowing who is asking.
    const [evidence, around, authored] = await Promise.all([
      loadConvictionEvidence(sb, target, viewer),
      loadPeopleAround(sb, target),
      // Authorship is participation, not a role — the count supports the "why
      // follow" line and the metrics footer, and is never shown as a badge.
      sb
        .from("markets")
        .select("onchain_id", { count: "exact", head: true })
        .eq("author_wallet", target),
    ]);
    const marketsCreated = Math.max(0, Number(authored.count ?? 0));

    const base: PersonProfile = {
      wallet: target,
      displayName: prof?.name ?? aliasFor(target),
      avatarUrl: prof?.avatarUrl ?? null,
      hasViewer: false,
      relationship: "insufficient",
      agreement: 0,
      sharedBeliefs: 0,
      evidenceLevel: "insufficient",
      summary: "Connect your wallet to see how your beliefs compare.",
      together: 0,
      apart: 0,
      topicCount: 0,
      alignedDomains: [],
      opposedDomains: [],
      sharedBoth: [],
      opposing: [],
      recentActivity,
      positions: evidence.positions,
      changes: evidence.changes,
      personMedianDays: evidence.personMedianDays,
      viewerMedianDays: null,
      around,
      marketsCreated,
      positionsTotal: evidence.positionsTotal,
      viewerTopics: [],
      viewerMarketIds: [],
    };
    if (!viewer || viewerFactors.length === 0) return base;

    // Exact viewer-relative DNA, computed on demand (bounded to one pair).
    const score = scoreRelationship(viewerFactors, targetFactors);
    const priorLabel = viewer ? await priorRelationship(sb, viewer, target) : undefined;
    const { relationship } = classifyRelationship({
      currentScore: score,
      previousRelationship: priorLabel,
    });

    // Domain map for shared markets.
    const viewerMarkets = viewerFactors.map((f) => Number(f.marketId));
    const domainOf = new Map<number, string>();
    for (let i = 0; i < viewerMarkets.length; i += 500) {
      const { data: mk } = await sb
        .from("markets")
        .select("onchain_id, category")
        .in("onchain_id", viewerMarkets.slice(i, i + 500));
      for (const m of (mk ?? []) as { onchain_id: number; category: string | null }[]) {
        const d = categoryToDomain(m.category);
        if (d) domainOf.set(Number(m.onchain_id), d);
      }
    }
    const domains = scoreDomains(
      viewerFactors,
      targetFactors,
      (id) => domainOf.get(Number(id)) ?? null,
    );
    const { aligned, opposed } = splitDomains(domains, 3);

    // Shared / opposing markets with titles.
    const targetById = new Map<number, DnaFactor>();
    for (const t of targetFactors) targetById.set(Number(t.marketId), t);
    const both: { id: number; side: "YES" | "NO" }[] = [];
    const opp: { id: number; vSide: "YES" | "NO"; pSide: "YES" | "NO" }[] = [];
    for (const v of viewerFactors) {
      const t = targetById.get(Number(v.marketId));
      if (!t) continue;
      if (t.side === v.side) both.push({ id: Number(v.marketId), side: v.side });
      else opp.push({ id: Number(v.marketId), vSide: v.side, pSide: t.side });
    }
    const titleIds = [...both.map((b) => b.id), ...opp.map((o) => o.id)];
    const titles = await marketTitles(sb, titleIds);

    return {
      wallet: target,
      displayName: prof?.name ?? aliasFor(target),
      avatarUrl: prof?.avatarUrl ?? null,
      hasViewer: true,
      relationship,
      agreement: Math.round(score.agreement),
      sharedBeliefs: score.sharedBeliefs,
      together: score.sameSideBeliefs,
      apart: score.oppositeSideBeliefs,
      // Breadth = distinct topics among the markets both hold.
      topicCount: new Set(
        [...both.map((b) => b.id), ...opp.map((o) => o.id)]
          .map((id) => domainOf.get(Number(id)))
          .filter((d): d is string => !!d),
      ).size,
      evidenceLevel: score.evidenceLevel,
      summary: personSummary(aligned, opposed),
      alignedDomains: aligned.map((d) => ({ domain: d.domain, agreement: d.agreement })),
      opposedDomains: opposed.map((d) => ({ domain: d.domain, agreement: d.agreement })),
      sharedBoth: both.slice(0, SHARED_CAP).map((b) => ({
        marketId: String(b.id),
        title: titles.get(b.id) ?? marketTitleFallback(b.id),
        viewerSide: b.side,
        personSide: b.side,
        domain: domainOf.get(Number(b.id)) ?? null,
      })),
      opposing: opp.slice(0, SHARED_CAP).map((o) => ({
        marketId: String(o.id),
        title: titles.get(o.id) ?? marketTitleFallback(o.id),
        viewerSide: o.vSide,
        personSide: o.pSide,
        domain: domainOf.get(Number(o.id)) ?? null,
      })),
      recentActivity,
      positions: evidence.positions,
      changes: evidence.changes,
      personMedianDays: evidence.personMedianDays,
      viewerMedianDays: evidence.viewerMedianDays,
      around,
      marketsCreated,
      positionsTotal: evidence.positionsTotal,
      // Counted from the domain map already built for the shared-market split —
      // no extra query, and the same vocabulary the aligned/opposed topics use.
      viewerTopics: (() => {
        const counts = new Map<string, number>();
        for (const id of viewerMarkets) {
          const d = domainOf.get(Number(id));
          if (d) counts.set(d, (counts.get(d) ?? 0) + 1);
        }
        return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([d]) => d);
      })(),
      viewerMarketIds: viewerMarkets,
    };
  });

/** The viewer's last stored label for `target` (hysteresis on the on-demand path). */
async function priorRelationship(
  sb: Sb,
  viewer: string,
  target: string,
): Promise<RelationshipLabel | undefined> {
  const cache = await readViewerDnaCache(sb, viewer);
  if (!cache) return undefined;
  for (const group of [cache.twin, cache.tribe, cache.neutral, cache.opp, cache.inverse])
    for (const r of group) if (r.wallet === target) return r.relationship;
  return undefined;
}

/**
 * ONE PAGE of a person's convictions — what makes "All convictions" a complete
 * browsing surface rather than a claim.
 *
 * `getPersonProfile` reads a capped slice because everything it composes from
 * (the introduction, the defining cards, the map) is a JUDGEMENT over a sample,
 * and sampling is fine there. The unabridged list is the one place sampling is
 * not fine: a section headed "All convictions · 260" that stops at 200 is
 * telling the visitor something untrue in the exact place the page exists to be
 * checkable.
 *
 * Its own function rather than a bigger cap on the profile, because the profile
 * payload is fetched on every person you look at and this is fetched only when
 * somebody asks for the rest.
 */
export const listPersonConvictions = createServerFn({ method: "GET" })
  .inputValidator((d: { wallet: string; offset?: number; limit?: number }) =>
    z
      .object({
        wallet: z.string().min(3),
        offset: z.number().int().min(0).max(10_000).optional(),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .parse(d),
  )
  .handler(async ({ data }): Promise<{ positions: PersonPosition[]; total: number }> => {
    const sb = serviceClient();
    const target = data.wallet.toLowerCase();
    const offset = data.offset ?? 0;
    const limit = data.limit ?? 100;

    const [page, totalRes] = await Promise.all([
      sb
        .from("wallet_beliefs")
        .select("onchain_id, stance_side, yes_value_usd, no_value_usd, days_held, first_backed_at")
        .eq("wallet", target)
        .in("stance_side", ["YES", "NO"])
        // Same order as the profile read, so paging continues the list a reader
        // is already looking at instead of reshuffling it under them.
        .order("days_held", { ascending: false })
        .range(offset, offset + limit - 1),
      sb
        .from("wallet_beliefs")
        .select("onchain_id", { count: "exact", head: true })
        .eq("wallet", target)
        .in("stance_side", ["YES", "NO"]),
    ]);

    type Row = {
      onchain_id: number;
      stance_side: "YES" | "NO";
      yes_value_usd: number | null;
      no_value_usd: number | null;
      days_held: number | null;
      first_backed_at: string | null;
    };
    const rows = (page.data ?? []) as unknown as Row[];
    const ids = rows.map((r) => Number(r.onchain_id));
    const [titles, meta] = await Promise.all([
      marketTitles(sb, ids),
      ids.length
        ? sb.from("markets").select("onchain_id, category").in("onchain_id", ids)
        : Promise.resolve({ data: [] as { onchain_id: number; category: string | null }[] }),
    ]);
    const categoryOf = new Map<number, string | null>();
    for (const m of (meta.data ?? []) as { onchain_id: number; category: string | null }[])
      categoryOf.set(Number(m.onchain_id), m.category);

    // Crowd and entry timing are omitted on purpose: this list renders a side, a
    // question and a duration, and loading two more tables to fill fields the
    // row never shows would be work thrown away.
    const positions: PersonPosition[] = rows.map((r) => {
      const id = Number(r.onchain_id);
      const backedMs = r.first_backed_at ? Date.parse(r.first_backed_at) : NaN;
      const value = r.stance_side === "YES" ? r.yes_value_usd : r.no_value_usd;
      return {
        marketId: id,
        title: titles.get(id) ?? marketTitleFallback(id),
        side: r.stance_side,
        valueUsd: value == null ? null : Number(value),
        daysHeld: Number(r.days_held) || 0,
        tenureIsFloor: Number.isFinite(backedMs) ? firstBackedIsFloor(backedMs) : false,
        crowdYesPct: null,
        participants: 0,
        category: categoryOf.get(id) ?? null,
        daysAfterOpen: null,
      };
    });
    return { positions, total: Math.max(positions.length, Number(totalRes.count ?? 0)) };
  });
