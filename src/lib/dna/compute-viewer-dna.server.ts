/**
 * Conviction DNA — compute one viewer's bounded network (server, v1).
 *
 * The single exact-scoring path:
 *   viewer directional positions
 *     → shared-market candidates (RPC, bounded ≤ maxExactScored)
 *     → set-based candidate positions (ONE query per chunk, never per candidate)
 *     → exact DNA (scoreRelationship) + per-domain (scoreDomains)
 *     → classify with hysteresis (previous label from the prior cache)
 *     → bucket twin/tribe/neutral/opp/inverse + closest + domain Circles
 *     → viewer_dna_cache
 *
 * Scoring/classification live in src/domain/dna/*; this module only does IO and
 * bounded assembly.
 */
import { publicClient, serviceClient } from "@/lib/supabase-clients";
import { categoryToDomain } from "@/domain/categories";
import {
  DNA_THRESHOLDS,
  DNA_LIMITS,
  CLOSEST_MIN_SHARED,
  CLOSEST_LIMIT,
  type RelationshipLabel,
} from "@/domain/dna/config";
import { scoreRelationship, type DnaFactor } from "@/domain/dna/score";
import {
  mergeBeliefFactors,
  onChainFactor,
  expressedFactor,
  pastFactor,
  type OnChainBeliefRow,
  type ExpressedBeliefRow,
} from "@/domain/beliefs";
import { classifyRelationship } from "@/domain/dna/classify";
import { scoreDomains, splitDomains } from "@/domain/dna/domains";
import { findDnaCandidates } from "./find-candidates.server";
import {
  getViewerDnaVersion,
  readViewerDnaCache,
  writeViewerDnaCache,
  type CachedRelationship,
  type DomainMember,
  type ViewerDnaCache,
  type ViewerDnaOutput,
} from "./viewer-dna-cache.server";

const EMPTY: ViewerDnaOutput = {
  twin: [],
  tribe: [],
  neutral: [],
  opp: [],
  inverse: [],
  closest: [],
  domains: {},
  candidateCount: 0,
  scoredCount: 0,
};

// The row → factor mappers live in @/domain/beliefs — one definition, shared
// with the profile path, which used to keep its own copy that read a null
// expressed weight as zero instead of EXPRESSED_WEIGHT.
type BeliefRow = OnChainBeliefRow & { wallet?: string };
type ExpressedRow = ExpressedBeliefRow & { wallet?: string };
type HistoricBeliefRow = BeliefRow & { last_directional_side: string | null };
const toFactor = onChainFactor;
const expressedToFactor = expressedFactor;

/**
 * Held now → a live factor. Left, but remembered → a past factor.
 *
 * The query admits both, so the discriminator is which column is directional.
 * `stance_side` wins: someone standing in a market today is described by where
 * they stand, never by where they used to.
 */
const factorFor = (r: HistoricBeliefRow) =>
  r.stance_side === "YES" || r.stance_side === "NO" ? onChainFactor(r) : pastFactor(r);

const isLive = (r: HistoricBeliefRow) => r.stance_side === "YES" || r.stance_side === "NO";

/**
 * THREE TIERS, strongest last: remembered → expressed → held.
 *
 * The old rule was "money beats a free tap", which was the whole story while
 * every on-chain factor was a live position. It is not any more: a conviction
 * someone LEFT is money that is no longer there, and a free belief they hold
 * today is a statement about today. So a current expressed belief outranks a
 * remembered position, and a live position still outranks both.
 */
const mergeTiers = (live: DnaFactor[], expressed: DnaFactor[], past: DnaFactor[]) =>
  mergeBeliefFactors(live, mergeBeliefFactors(expressed, past));

async function loadDomains(
  sb: ReturnType<typeof publicClient>,
  marketIds: number[],
): Promise<Map<number, string>> {
  const domainOf = new Map<number, string>();
  for (let i = 0; i < marketIds.length; i += 500) {
    const { data } = await sb
      .from("markets")
      .select("onchain_id, category")
      .in("onchain_id", marketIds.slice(i, i + 500));
    for (const m of (data ?? []) as { onchain_id: number; category: string | null }[]) {
      const d = categoryToDomain(m.category);
      if (d) domainOf.set(Number(m.onchain_id), d);
    }
  }
  return domainOf;
}

export async function computeViewerDna(viewerWallet: string): Promise<ViewerDnaCache> {
  const viewer = viewerWallet.toLowerCase();
  const pub = publicClient();
  const svc = serviceClient();
  const version = await getViewerDnaVersion(svc, viewer);

  // Prior rows → hysteresis (a held relationship survives to its exit band) AND
  // the relationship's own history: when its label was set, and what it was
  // before. That history is what lets the feed say "you found a Twin" without a
  // second event pipeline (src/domain/discovery-moment).
  const prior = await readViewerDnaCache(svc, viewer);
  const priorRow = new Map<string, CachedRelationship>();
  if (prior) {
    for (const group of [prior.twin, prior.tribe, prior.neutral, prior.opp, prior.inverse])
      for (const r of group) priorRow.set(r.wallet, r);
  }
  const priorLabel = new Map<string, RelationshipLabel>(
    [...priorRow].map(([w, r]) => [w, r.relationship]),
  );
  const nowIso = new Date().toISOString();

  // 1. Viewer directional factors — on-chain positions ∪ free expressed beliefs
  //    (expressed at a low weight; an on-chain position always overrides).
  //    A row that is no longer directional but REMEMBERS a side (see
  //    wallet_beliefs.last_directional_side) contributes a past factor, so a
  //    conviction someone has left keeps counting at PAST_WEIGHT instead of
  //    vanishing. One query, not two: the live and remembered rows live in the
  //    same table and are told apart by which column is populated.
  const [{ data: mine }, { data: mineExpressed }] = await Promise.all([
    svc
      .from("wallet_beliefs")
      .select("onchain_id, stance_side, conviction, last_directional_side")
      .eq("wallet", viewer)
      .or("stance_side.in.(YES,NO),last_directional_side.in.(YES,NO)"),
    svc.from("expressed_beliefs").select("onchain_id, side, weight").eq("wallet", viewer),
  ]);
  const mineRows = (mine ?? []) as HistoricBeliefRow[];
  const viewerFactors = mergeTiers(
    mineRows.filter(isLive).map(factorFor),
    ((mineExpressed ?? []) as ExpressedRow[]).map(expressedToFactor),
    mineRows.filter((r) => !isLive(r)).map(factorFor),
  );

  // Enough for a "closest" read; strong Twin/Tribe labels still need more shared.
  if (viewerFactors.length < CLOSEST_MIN_SHARED) {
    await writeViewerDnaCache(svc, viewer, version, EMPTY);
    return (await readViewerDnaCache(svc, viewer))!;
  }
  const viewerMarkets = viewerFactors.map((f) => Number(f.marketId));

  // 2. Bounded candidate pool — low floor so thin-overlap people can still be
  //    closest matches; the strong-band thresholds prune below.
  const candidates = await findDnaCandidates(svc, viewer, { minShared: CLOSEST_MIN_SHARED });
  const candidateWallets = candidates.map((c) => c.wallet);

  // 3. Candidate directional factors (set-based, chunked for `in` size only).
  //    On-chain ∪ expressed per candidate, on-chain overriding on a shared market.
  const candidateOnChain = new Map<string, DnaFactor[]>();
  const candidatePast = new Map<string, DnaFactor[]>();
  const candidateExpressed = new Map<string, DnaFactor[]>();
  for (let i = 0; i < candidateWallets.length; i += 200) {
    const chunk = candidateWallets.slice(i, i + 200);
    if (chunk.length === 0) break;
    const [{ data: onchain }, { data: expressed }] = await Promise.all([
      svc
        .from("wallet_beliefs")
        .select("wallet, onchain_id, stance_side, conviction, last_directional_side")
        .in("wallet", chunk)
        .in("onchain_id", viewerMarkets)
        .or("stance_side.in.(YES,NO),last_directional_side.in.(YES,NO)"),
      svc
        .from("expressed_beliefs")
        .select("wallet, onchain_id, side, weight")
        .in("wallet", chunk)
        .in("onchain_id", viewerMarkets),
    ]);
    for (const r of (onchain ?? []) as HistoricBeliefRow[]) {
      const w = String(r.wallet).toLowerCase();
      const into = isLive(r) ? candidateOnChain : candidatePast;
      const arr = into.get(w) ?? [];
      arr.push(factorFor(r));
      into.set(w, arr);
    }
    for (const r of (expressed ?? []) as ExpressedRow[]) {
      const w = String(r.wallet).toLowerCase();
      const arr = candidateExpressed.get(w) ?? [];
      arr.push(expressedToFactor(r));
      candidateExpressed.set(w, arr);
    }
  }
  const candidateFactors = new Map<string, DnaFactor[]>();
  for (const w of new Set([
    ...candidateOnChain.keys(),
    ...candidatePast.keys(),
    ...candidateExpressed.keys(),
  ])) {
    candidateFactors.set(
      w,
      mergeTiers(
        candidateOnChain.get(w) ?? [],
        candidateExpressed.get(w) ?? [],
        candidatePast.get(w) ?? [],
      ),
    );
  }

  // 4. Domain map for the viewer's markets (covers all shared markets).
  const domainOfMarket = await loadDomains(pub, viewerMarkets);
  const domainOf = (id: string | number) => domainOfMarket.get(Number(id)) ?? null;

  // 5. Exact score + classify + per-domain (pure).
  const bucket: Record<RelationshipLabel, CachedRelationship[]> = {
    twin: [],
    tribe: [],
    neutral: [],
    opp: [],
    inverse: [],
    insufficient: [],
  };
  const domainMembers: Record<string, DomainMember[]> = {};
  // Everyone with meaningful overlap, regardless of whether they hit a strong
  // band — this is the "closest people" fallback so the Network is never empty.
  const closestPool: CachedRelationship[] = [];
  let scored = 0;

  // The viewer's own markets — used to count how many distinct TOPICS a
  // relationship spans (breadth), which the earned Twin/Opp labels require.
  const viewerMarketIds = new Set(viewerFactors.map((f) => String(f.marketId)));

  for (const [wallet, factors] of candidateFactors) {
    const s = scoreRelationship(viewerFactors, factors);
    scored += 1;
    if (s.sharedBeliefs < CLOSEST_MIN_SHARED) continue;
    const { relationship } = classifyRelationship({
      currentScore: s,
      previousRelationship: priorLabel.get(wallet),
    });

    const domains = scoreDomains(viewerFactors, factors, domainOf);
    const { aligned, opposed } = splitDomains(domains, 1);
    // Breadth: distinct topics among the markets BOTH hold — evidence quality,
    // not just quantity (a Twin must span topics, not repeat one).
    const topics = new Set<string>();
    for (const f of factors) {
      if (!viewerMarketIds.has(String(f.marketId))) continue;
      const d = domainOf(f.marketId);
      if (d) topics.add(d);
    }
    // Un-banded people read as "neutral", so compare against the same mapping
    // the row stores — otherwise every neutral would look like it changed today.
    const stored: RelationshipLabel = relationship === "insufficient" ? "neutral" : relationship;
    const before = priorRow.get(wallet);
    const changed = !!before && before.relationship !== stored;

    const row: CachedRelationship = {
      wallet,
      agreement: Math.round(s.agreement),
      sharedBeliefs: s.sharedBeliefs,
      sameSideBeliefs: s.sameSideBeliefs,
      oppositeSideBeliefs: s.oppositeSideBeliefs,
      topicCount: topics.size,
      confidence: s.confidence,
      evidenceLevel: s.evidenceLevel,
      // Un-banded people read as "neutral" (some overlap, no strong signal yet).
      relationship: stored,
      // A relationship we are meeting for the first time gets NO timestamp. We
      // genuinely do not know when it formed — this may be the viewer's first
      // ever computation, covering years of history — and dating it "now" would
      // announce a Twin the reader has had all along. Only a label we WATCHED
      // change is dated, which is exactly the set that deserves announcing.
      ...(changed
        ? { since: nowIso, previous: before?.relationship ?? null }
        : before?.since
          ? { since: before.since, previous: before.previous ?? null }
          : {}),
      strongestAlignedDomain: aligned[0]
        ? { name: aligned[0].domain, agreement: aligned[0].agreement }
        : undefined,
      strongestOpposedDomain: opposed[0]
        ? { name: opposed[0].domain, agreement: opposed[0].agreement }
        : undefined,
    };

    // Always eligible as a "closest" person.
    closestPool.push(row);

    // Strong labels still require the full evidence bar.
    if (s.sharedBeliefs >= DNA_THRESHOLDS.minSharedOverall && relationship !== "insufficient") {
      bucket[relationship].push(row);
      // Domain Circles: aligned (twin/tribe) domain memberships feed the overview.
      for (const d of domains) {
        if (d.relationship !== "twin" && d.relationship !== "tribe") continue;
        const arr = domainMembers[d.domain] ?? [];
        arr.push({ wallet, agreement: d.agreement, relationship: d.relationship });
        domainMembers[d.domain] = arr;
      }
    }
  }

  // 6. Sort + cap each bucket. High bands by agreement desc; low bands asc.
  const byAgreementDesc = (a: CachedRelationship, b: CachedRelationship) =>
    b.agreement - a.agreement || b.sharedBeliefs - a.sharedBeliefs;
  const byAgreementAsc = (a: CachedRelationship, b: CachedRelationship) =>
    a.agreement - b.agreement || b.sharedBeliefs - a.sharedBeliefs;
  const cap = DNA_LIMITS.maxPerGroup;

  const twin = bucket.twin.sort(byAgreementDesc).slice(0, cap);
  const tribe = bucket.tribe.sort(byAgreementDesc).slice(0, cap);
  const neutral = bucket.neutral.sort(byAgreementDesc).slice(0, cap);
  const opp = bucket.opp.sort(byAgreementAsc).slice(0, cap);
  const inverse = bucket.inverse.sort(byAgreementAsc).slice(0, cap);
  // Closest = the highest-agreement people who share ANY meaningful overlap, so
  // there's always someone to show even before strong bands form.
  const closest = closestPool.sort(byAgreementDesc).slice(0, CLOSEST_LIMIT);

  for (const d of Object.keys(domainMembers)) {
    domainMembers[d] = domainMembers[d].sort((a, b) => b.agreement - a.agreement).slice(0, cap);
  }

  const out: ViewerDnaOutput = {
    twin,
    tribe,
    neutral,
    opp,
    inverse,
    closest,
    domains: domainMembers,
    candidateCount: candidates.length,
    scoredCount: scored,
  };

  await writeViewerDnaCache(svc, viewer, version, out);
  return (await readViewerDnaCache(svc, viewer))!;
}
