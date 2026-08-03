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
import { CIRCLE_MIN_PEOPLE, type EvidenceLevel, type RelationshipLabel } from "@/domain/dna/config";
import { scoreRelationship, type DnaFactor } from "@/domain/dna/score";
import { classifyRelationship } from "@/domain/dna/classify";
import { scoreDomains, splitDomains } from "@/domain/dna/domains";
import {
  readViewerDnaCache,
  type CachedRelationship,
  type DomainSummary,
  type ViewerDnaCache,
} from "@/lib/dna/viewer-dna-cache.server";

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
      marketTitle: titles.get(Number(r.market_id)) ?? `Market #${r.market_id}`,
      side: r.side === "NO" ? "NO" : "YES",
      action: r.action ?? "backed",
      occurredAt: r.occurred_at,
    });
  }
  return out;
}

async function marketTitles(sb: Sb, ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for (let i = 0; i < ids.length; i += 500) {
    const { data } = await sb
      .from("markets")
      .select("onchain_id, title")
      .in("onchain_id", ids.slice(i, i + 500));
    for (const m of (data ?? []) as { onchain_id: number; title: string | null }[])
      out.set(Number(m.onchain_id), m.title ?? `Market #${m.onchain_id}`);
  }
  return out;
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

  const byMarket = new Map<number, DnaFactor>();
  for (const r of (expressed.data ?? []) as {
    onchain_id: number;
    side: string;
    weight: number | null;
  }[]) {
    if (r.side !== "YES" && r.side !== "NO") continue;
    byMarket.set(Number(r.onchain_id), {
      marketId: Number(r.onchain_id),
      side: r.side,
      conviction: Math.abs(Number(r.weight ?? 0)),
    });
  }
  for (const r of (traded.data ?? []) as {
    onchain_id: number;
    stance_side: string;
    conviction: number | null;
  }[]) {
    byMarket.set(Number(r.onchain_id), {
      marketId: Number(r.onchain_id),
      side: r.stance_side === "NO" ? "NO" : "YES",
      conviction: Math.abs(Number(r.conviction ?? 0)),
    });
  }
  return [...byMarket.values()];
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
};

export type PersonProfile = {
  wallet: string;
  displayName: string;
  avatarUrl: string | null;
  hasViewer: boolean;
  relationship: RelationshipLabel;
  agreement: number;
  sharedBeliefs: number;
  evidenceLevel: EvidenceLevel;
  summary: string;
  alignedDomains: { domain: string; agreement: number }[];
  opposedDomains: { domain: string; agreement: number }[];
  sharedBoth: SharedMarket[];
  opposing: SharedMarket[];
  recentActivity: Activity[];
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
      alignedDomains: [],
      opposedDomains: [],
      sharedBoth: [],
      opposing: [],
      recentActivity,
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
      evidenceLevel: score.evidenceLevel,
      summary: personSummary(aligned, opposed),
      alignedDomains: aligned.map((d) => ({ domain: d.domain, agreement: d.agreement })),
      opposedDomains: opposed.map((d) => ({ domain: d.domain, agreement: d.agreement })),
      sharedBoth: both.slice(0, 40).map((b) => ({
        marketId: String(b.id),
        title: titles.get(b.id) ?? `Market #${b.id}`,
        viewerSide: b.side,
        personSide: b.side,
      })),
      opposing: opp.slice(0, 40).map((o) => ({
        marketId: String(o.id),
        title: titles.get(o.id) ?? `Market #${o.id}`,
        viewerSide: o.vSide,
        personSide: o.pSide,
      })),
      recentActivity,
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
