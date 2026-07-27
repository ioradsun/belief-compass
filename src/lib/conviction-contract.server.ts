/**
 * Conviction data contract — server only.
 *
 * Every number, ranking, threshold and label the client renders is produced
 * here. Nothing in this file may be moved into a component: match computation,
 * confidence thresholds, Top Voice selection, story ranking, conviction
 * scoring and cost-basis derivation are all upstream concerns.
 */
import { publicClient } from "@/lib/supabase-clients";
import { resolveProfiles } from "@/lib/profiles.server";
import type {
  Belief,
  OnboardingBelief,
  Person,
  Position,
  ProfileState,
  RoomStory,
  Side,
  SideKey,
  Viewer,
} from "@/lib/contract";

/* ------------------------------------------------------------------ *
 * Thresholds. These live server-side and are never exposed as inputs.
 * ------------------------------------------------------------------ */

/** A DNA match is only shown once the pair overlaps on this many markets. */
const MATCH_CONFIDENCE_MIN_SHARED = 5;
/** Below this many backed beliefs the viewer's own graph is not trustworthy. */
const QUALIFIED_MIN_BELIEFS = 3;
/** People shown per side. */
const PEOPLE_PER_SIDE = 5;

const DUST = 0.01;

/* ------------------------------ formatting ------------------------------ */

function usd(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`;
  if (a >= 1_000) return `$${(n / 1_000).toFixed(a >= 10_000 ? 0 : 1)}K`;
  if (a >= 1) return `$${n.toFixed(0)}`;
  return `$${n.toFixed(2)}`;
}

function pct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function ago(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return `${Math.round(d / 30)}mo ago`;
}

function opened(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 86400000));
  if (d === 0) return "opened today";
  if (d === 1) return "opened yesterday";
  if (d < 60) return `opened ${d} days ago`;
  return `opened ${Math.round(d / 30)} months ago`;
}

/** Deterministic neutral alias, so a wallet without a POV name is still a person. */
const ADJ = ["quiet", "steady", "early", "patient", "plain", "long", "careful", "level"];
const NOUN = ["holder", "reader", "watcher", "builder", "believer", "voice", "hand", "witness"];
function alias(wallet: string): string {
  let h = 0;
  for (let i = 2; i < wallet.length; i++) h = (h * 31 + wallet.charCodeAt(i)) >>> 0;
  return `${ADJ[h % ADJ.length]} ${NOUN[(h >> 5) % NOUN.length]}`;
}

const norm = (a?: string | null) => (a ? a.toLowerCase() : null);
const sideKey = (s?: string | null): SideKey | null =>
  s === "YES" || s === "yes" ? "y" : s === "NO" || s === "no" ? "n" : null;

/* ------------------------------ viewer ------------------------------ */

export async function getViewer(address: string | null): Promise<Viewer> {
  const addr = norm(address);
  if (!addr) return { address: null, profile: "none", beliefsBacked: 0 };

  const sb = publicClient();
  const { data } = await sb
    .from("wallet_beliefs")
    .select("onchain_id, yes_shares, no_shares")
    .eq("wallet", addr);

  const backed = (data ?? []).filter(
    (r) => Number(r.yes_shares ?? 0) > DUST || Number(r.no_shares ?? 0) > DUST,
  ).length;

  const profile: ProfileState =
    backed === 0 ? "none" : backed >= QUALIFIED_MIN_BELIEFS ? "qualified" : "provisional";

  return { address: addr, profile, beliefsBacked: backed };
}

/** Confidence-gated match table for the viewer: wallet → matchPct. */
async function matchTable(viewer: string | null): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!viewer) return out;
  const sb = publicClient();
  const { data } = await sb
    .from("wallet_matches")
    .select("matched_wallet, match_score, shared_markets, domain")
    // Overall Tribe rows are written with domain = NULL by the batch matcher
    // (dna-batch.server); per-domain Circle rows carry a domain. Overall only here.
    .eq("wallet", viewer)
    .is("domain", null)
    .gte("shared_markets", MATCH_CONFIDENCE_MIN_SHARED)
    .order("match_score", { ascending: false })
    .limit(500);
  for (const r of data ?? []) {
    const w = norm(r.matched_wallet);
    if (w) out.set(w, Math.round(Number(r.match_score)));
  }
  return out;
}

/* ------------------------------ positions ------------------------------ */

export async function getPositions(address: string | null): Promise<Position[]> {
  const addr = norm(address);
  if (!addr) return [];
  const sb = publicClient();

  const { data: beliefs } = await sb
    .from("wallet_beliefs")
    .select("onchain_id, yes_shares, no_shares, expressed_side, days_held, conviction")
    .eq("wallet", addr)
    .order("conviction", { ascending: false })
    .limit(60);

  const rows = (beliefs ?? []).filter(
    (r) => Number(r.yes_shares ?? 0) > DUST || Number(r.no_shares ?? 0) > DUST,
  );
  if (rows.length === 0) return [];

  const ids = rows.map((r) => Number(r.onchain_id));
  const [{ data: markets }, { data: states }, viewer] = await Promise.all([
    sb.from("markets").select("onchain_id, title").in("onchain_id", ids),
    sb.from("market_state").select("onchain_id, yes_price_usd, no_price_usd").in("onchain_id", ids),
    getViewer(addr),
  ]);
  const title = new Map((markets ?? []).map((m) => [Number(m.onchain_id), m.title as string]));
  const price = new Map(
    (states ?? []).map((s) => [
      Number(s.onchain_id),
      { y: Number(s.yes_price_usd ?? 0), n: Number(s.no_price_usd ?? 0) },
    ]),
  );

  // Social context is only honest once the viewer's own graph qualifies.
  let company = new Map<number, number>();
  if (viewer.profile === "qualified") {
    const matches = await matchTable(addr);
    if (matches.size > 0) {
      const { data: others } = await sb
        .from("wallet_beliefs")
        .select("onchain_id, wallet, expressed_side")
        .in("onchain_id", ids)
        .in("wallet", [...matches.keys()].slice(0, 200));
      company = new Map();
      for (const o of others ?? []) {
        const id = Number(o.onchain_id);
        company.set(id, (company.get(id) ?? 0) + 1);
      }
    }
  }

  return rows.map((r) => {
    const id = Number(r.onchain_id);
    const side: SideKey = sideKey(r.expressed_side) ?? (Number(r.yes_shares) >= Number(r.no_shares) ? "y" : "n");
    const shares = side === "y" ? Number(r.yes_shares ?? 0) : Number(r.no_shares ?? 0);
    const p = price.get(id);
    const value = shares * (side === "y" ? (p?.y ?? 0) : (p?.n ?? 0));
    const days = Math.max(0, Math.round(Number(r.days_held ?? 0)));
    const withYou = company.get(id) ?? 0;
    return {
      beliefId: String(id),
      question: title.get(id) ?? `Belief #${id}`,
      side,
      value: usd(value),
      changeLabel: days === 0 ? "held today" : days === 1 ? "held 1 day" : `held ${days} days`,
      socialContext:
        viewer.profile === "qualified" && withYou > 0
          ? `${withYou} ${withYou === 1 ? "person" : "people"} you match with ${withYou === 1 ? "is" : "are"} here`
          : null,
    } satisfies Position;
  });
}

/* ------------------------------ belief room ------------------------------ */

function sampleSeries(values: number[], target = 24): number[] {
  if (values.length <= target) return values;
  const step = values.length / target;
  return Array.from({ length: target }, (_, i) => values[Math.floor(i * step)]);
}

async function peopleFor(
  ids: number[],
  matches: Map<string, number>,
  qualified: boolean,
  viewer: string | null,
): Promise<Map<number, Array<Person & { side: SideKey }>>> {
  const sb = publicClient();
  const { data } = await sb
    .from("wallet_beliefs")
    .select("onchain_id, wallet, expressed_side, yes_shares, no_shares, days_held, conviction")
    .in("onchain_id", ids)
    .order("conviction", { ascending: false })
    .limit(400);

  const rows = (data ?? []).filter((r) => norm(r.wallet) !== viewer);
  const profiles = await resolveProfiles(rows.slice(0, 60).map((r) => String(r.wallet)));

  const out = new Map<number, Array<Person & { side: SideKey }>>();
  for (const r of rows) {
    const id = Number(r.onchain_id);
    const w = norm(r.wallet)!;
    const side = sideKey(r.expressed_side);
    if (!side) continue;
    const list = out.get(id) ?? [];
    // Ranking is upstream: matched people first, then conviction order.
    const shares = side === "y" ? Number(r.yes_shares ?? 0) : Number(r.no_shares ?? 0);
    if (shares <= DUST) continue;
    const days = Math.max(0, Math.round(Number(r.days_held ?? 0)));
    const p = profiles.get(w);
    list.push({
      alias: p?.displayName ?? alias(w),
      avatarSeed: w,
      avatarUrl: p?.pfpUrl ?? null,
      matchPct: qualified ? (matches.get(w) ?? null) : null,
      positionLabel: `${days} ${days === 1 ? "day" : "days"}`,
      side,
    });
    out.set(id, list);
  }
  for (const [id, list] of out) {
    list.sort((a, b) => (b.matchPct ?? -1) - (a.matchPct ?? -1));
    out.set(id, list);
  }
  return out;
}

export async function getBelief(beliefId: string, address: string | null): Promise<Belief | null> {
  const id = Number(beliefId);
  if (!Number.isFinite(id)) return null;
  const sb = publicClient();
  const viewerAddr = norm(address);

  const [{ data: market }, { data: state }, { data: snaps }, viewer] = await Promise.all([
    sb
      .from("markets")
      .select("onchain_id, title, category, author_wallet, author_name, created_at, first_seen")
      .eq("onchain_id", id)
      .maybeSingle(),
    sb.from("market_state").select("*").eq("onchain_id", id).maybeSingle(),
    sb
      .from("price_snapshots")
      .select("captured_at, yes_price_usd, no_price_usd")
      .eq("onchain_id", id)
      .gte("captured_at", new Date(Date.now() - 86400000).toISOString())
      .order("captured_at", { ascending: true })
      .limit(400),
    getViewer(address),
  ]);
  if (!market) return null;

  const { data: calib } = await sb.rpc("eth_usd_calibration");
  const ethUsd = Number(calib ?? 0) || 0;

  const qualified = viewer.profile === "qualified";
  const matches = await matchTable(qualified ? viewerAddr : null);
  const peopleMap = await peopleFor([id], matches, qualified, viewerAddr);
  const all = peopleMap.get(id) ?? [];

  const ySeries = sampleSeries((snaps ?? []).map((s) => Number(s.yes_price_usd ?? 0)).filter(Number.isFinite));
  const nSeries = sampleSeries((snaps ?? []).map((s) => Number(s.no_price_usd ?? 0)).filter(Number.isFinite));

  const yesPeople = qualified ? all.filter((p) => p.side === "y").slice(0, PEOPLE_PER_SIDE) : [];
  const noPeople = qualified ? all.filter((p) => p.side === "n").slice(0, PEOPLE_PER_SIDE) : [];
  const tribeYes = all.filter((p) => p.side === "y" && p.matchPct != null).length;
  const tribeNo = all.filter((p) => p.side === "n" && p.matchPct != null).length;

  const side = (k: SideKey): Side => ({
    price: Number((k === "y" ? state?.yes_price_usd : state?.no_price_usd) ?? 0),
    changePct: Number((k === "y" ? state?.chg_24h_yes : state?.chg_24h_no) ?? 0),
    series: k === "y" ? ySeries : nSeries,
    believers: Number((k === "y" ? state?.believers_yes : state?.believers_no) ?? 0),
    capital: usd(Number((k === "y" ? state?.yes_capital_usd : state?.no_capital_usd) ?? 0)),
    people: k === "y" ? yesPeople : noPeople,
    moreFromTribe: Math.max(0, (k === "y" ? tribeYes : tribeNo) - PEOPLE_PER_SIDE),
    // Perspectives are authored upstream; none are supplied yet.
    perspective: null,
  });

  const relationshipRead =
    qualified && tribeYes + tribeNo > 0
      ? tribeYes >= tribeNo
        ? `${tribeYes} ${tribeYes === 1 ? "person" : "people"} you match with stand on YES here`
        : `${tribeNo} ${tribeNo === 1 ? "person" : "people"} you match with stand on NO here`
      : null;

  const by = Number(state?.believers_yes ?? 0);
  const bn = Number(state?.believers_no ?? 0);

  return {
    id: String(id),
    category: (market.category as string) ?? "Uncategorised",
    question: (market.title as string) ?? `Belief #${id}`,
    creatorAlias: (market.author_name as string) ?? alias(String(market.author_wallet ?? "0x00")),
    openedAgo: opened((market.created_at ?? market.first_seen) as string),
    y: side("y"),
    n: side("n"),
    relationshipRead,
    history: {
      // volume_24h_usd is stored in wei by the indexer; convert to USD here so
      // the client never does math.
      volumeToday: usd((Number(state?.volume_24h_usd ?? 0) / 1e18) * ethUsd),
      volumeChangePct: pct(state?.chg_24h == null ? null : Number(state.chg_24h)),
      newBelievers: Number(state?.new_believers_1h ?? 0),
      believerSplit: `${by} YES · ${bn} NO`,
      series: { y: ySeries, n: nSeries },
    },
    believers: all.slice(0, 12),
    defense: [],
  };
}

/* ------------------------------ the room ------------------------------ */

export async function getRoomFeed(address: string | null, limit = 24): Promise<RoomStory[]> {
  const sb = publicClient();
  const viewerAddr = norm(address);
  const viewer = await getViewer(address);
  const matches = await matchTable(viewer.profile === "qualified" ? viewerAddr : null);

  const { data: events } = await sb
    .from("feed_events")
    .select("onchain_id, wallet, type, side, payload, occurred_at")
    .order("occurred_at", { ascending: false })
    .limit(limit * 3);

  const rows = (events ?? []).slice(0, limit * 2);
  if (rows.length === 0) return [];

  const ids = [...new Set(rows.map((r) => Number(r.onchain_id)))];
  const [{ data: markets }, profiles] = await Promise.all([
    sb.from("markets").select("onchain_id, title").in("onchain_id", ids),
    resolveProfiles(rows.map((r) => String(r.wallet ?? "")).filter(Boolean), 12),
  ]);
  const title = new Map((markets ?? []).map((m) => [Number(m.onchain_id), m.title as string]));

  const stories: RoomStory[] = rows.map((r) => {
    const w = norm(r.wallet) ?? "0x0";
    const p = profiles.get(w);
    const name = p?.displayName ?? alias(w);
    const s = sideKey(r.side);
    const sideLabel = s === "y" ? "YES" : s === "n" ? "NO" : "";
    const payload = (r.payload ?? {}) as Record<string, unknown>;
    const value = Number(payload.usd ?? payload.value_usd ?? 0);
    const isTribe = matches.has(w);
    const verb =
      r.type === "exit" || r.type === "cut"
        ? "stepped back from"
        : r.type === "reversal" || r.type === "flip"
          ? "changed side on"
          : "stood behind";
    return {
      beliefId: String(r.onchain_id),
      marker: isTribe ? "tribe" : value >= 1000 ? "attention" : "neutral",
      markerLabel: isTribe ? "Tribe" : value >= 1000 ? "Attention" : "",
      story: `${name} ${verb} ${sideLabel}`.trim(),
      question: title.get(Number(r.onchain_id)) ?? `Belief #${r.onchain_id}`,
      values: value > 0 ? usd(value) : "",
      ago: ago(r.occurred_at as string),
    };
  });

  // Ranking is upstream: tribe first within recency, then everything else.
  return stories
    .map((s, i) => ({ s, i, w: s.marker === "tribe" ? 0 : s.marker === "attention" ? 1 : 2 }))
    .sort((a, b) => a.w - b.w || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.s);
}

/* ------------------------------ onboarding ------------------------------ */

export async function getOnboardingBeliefs(): Promise<OnboardingBelief[]> {
  const sb = publicClient();
  const { data: states } = await sb
    .from("market_state")
    .select("onchain_id, trending_score")
    .not("trending_score", "is", null)
    .order("trending_score", { ascending: false })
    .limit(12);
  const ids = (states ?? []).map((s) => Number(s.onchain_id));
  if (ids.length === 0) return [];
  const { data: markets } = await sb
    .from("markets")
    .select("onchain_id, title, category")
    .in("onchain_id", ids);
  const byId = new Map((markets ?? []).map((m) => [Number(m.onchain_id), m]));
  return ids
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((m) => ({
      id: String(m!.onchain_id),
      category: (m!.category as string) ?? "Uncategorised",
      question: (m!.title as string) ?? `Belief #${m!.onchain_id}`,
    }));
}
