/**
 * Conviction Signal Feed — server function.
 *
 * Reads ONLY Supabase and computes nothing new: it folds the real trade events
 * the reducer already produced (`feed_events`) together with `market_state`,
 * `markets`, `wallet_beliefs` and (viewer-relative) `wallet_matches` into ranked
 * story cards. Wealth is tier-1 capital flow only — trade size × price — which is
 * always honest and needs no cost basis. Realized/unrealized P&L are later,
 * gated tiers and are deliberately absent here.
 *
 * Actor is a parameter: with no viewer the feed runs at network/creator scale;
 * pass a viewer `wallet` and People/Opp individual cards light up from
 * `wallet_matches`.
 */
import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  type FeedCard,
  type Side,
  wealthFlow,
  marketActor,
  individualActor,
  creatorActor,
  fmtCount,
  aliasFor,
  rankScore,
} from "@/lib/conviction-feed";

function publicClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`)
          h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

const WINDOW_EVENTS = 500; // how many recent trade events to fold
const MAX_CARDS = 40;
const BIG_MOVE_PCT = 25; // |chg| above which an unattributed move is still worth a row
const RECENT_CREATE_MS = 3 * 24 * 3600 * 1000; // "just created" window for creator early-signal

type EventRow = {
  onchain_id: number;
  wallet: string;
  type: string; // "backed" | "reduced"
  side: string; // "YES" | "NO"
  payload: { eth?: string; tokens?: string } | null;
  occurred_at: string;
  event_key: string;
};

type MarketState = {
  onchain_id: number;
  yes_price_usd: number | null;
  no_price_usd: number | null;
  chg_1h: number | null;
  chg_24h: number | null;
  believers_yes: number | null;
  believers_no: number | null;
  new_believers_1h: number | null;
};

type MarketMeta = {
  onchain_id: number;
  title: string | null;
  author_wallet: string | null;
  author_name: string | null;
  created_at: string | null;
};

/** tokens (wei of belief-token) × per-share USD price → tier-1 capital flow in USD. */
function eventUsd(ev: EventRow, ms: MarketState | undefined): number {
  const tokens = Number(ev.payload?.tokens ?? 0) / 1e18;
  if (!Number.isFinite(tokens) || tokens <= 0) return 0;
  const price = ev.side === "YES" ? ms?.yes_price_usd : ms?.no_price_usd;
  if (price == null || !(price > 0)) return 0;
  return tokens * price;
}

/** The market's headline move: prefer the 24h change, fall back to 1h. */
function marketChg(ms: MarketState | undefined): number | null {
  if (!ms) return null;
  return ms.chg_24h ?? ms.chg_1h ?? null;
}

interface MarketAgg {
  onchain_id: number;
  buckets: { yesIn: number; yesOut: number; noIn: number; noOut: number };
  backed: Set<string>;
  reduced: Set<string>;
  latest: string; // max occurred_at
  byWallet: Map<string, { side: Side; usdIn: number; usdOut: number }>;
}

export const listConvictionFeed = createServerFn({ method: "GET" })
  .inputValidator((d: { wallet?: string } | undefined) =>
    z.object({ wallet: z.string().min(3).optional() }).parse(d ?? {}),
  )
  .handler(async ({ data }) => {
    const sb = publicClient();
    const viewer = data.wallet ? data.wallet.toLowerCase() : null;

    // 1. Recent real trade events — the spine of the feed.
    const { data: rawEvents, error } = await sb
      .from("feed_events")
      .select("onchain_id, wallet, type, side, payload, occurred_at, event_key")
      .order("occurred_at", { ascending: false })
      .limit(WINDOW_EVENTS);
    if (error) return { data: [] as FeedCard[], viewer, hasPeople: false, error: error.message };

    const events = (rawEvents ?? []) as EventRow[];
    if (events.length === 0)
      return { data: [] as FeedCard[], viewer, hasPeople: false, error: null };

    const marketIds = [...new Set(events.map((e) => e.onchain_id))];

    // 2. Supporting state, markets, and (viewer-relative) People/Opp — in parallel.
    const [stateRes, metaRes, matchesRes] = await Promise.all([
      sb
        .from("market_state")
        .select(
          "onchain_id, yes_price_usd, no_price_usd, chg_1h, chg_24h, believers_yes, believers_no, new_believers_1h",
        )
        .in("onchain_id", marketIds),
      sb
        .from("markets")
        .select("onchain_id, title, author_wallet, author_name, created_at")
        .in("onchain_id", marketIds),
      viewer
        ? sb
            .from("wallet_matches")
            .select("matched_wallet, match_score")
            .eq("wallet", viewer)
            .order("match_score", { ascending: false })
        : Promise.resolve({ data: null }),
    ]);

    const stateById = new Map<number, MarketState>();
    for (const s of (stateRes.data ?? []) as MarketState[]) stateById.set(s.onchain_id, s);
    const metaById = new Map<number, MarketMeta>();
    for (const m of (metaRes.data ?? []) as MarketMeta[]) metaById.set(m.onchain_id, m);

    // People = closest match; Opp = most-opposite active wallet (only if genuinely
    // opposed, score < 50). Keeps the opposite pole always representable.
    const matches = (matchesRes.data ?? []) as { matched_wallet: string; match_score: number }[];
    const people = matches[0] ?? null;
    const oppCand = matches[matches.length - 1] ?? null;
    const opp = oppCand && oppCand.match_score < 50 ? oppCand : null;
    const hasPeople = Boolean(people);

    // Belief rows for People/Opp across these markets — for behavior + context.
    const focusWallets = [people?.matched_wallet, opp?.matched_wallet].filter(Boolean) as string[];
    const beliefByKey = new Map<
      string,
      { first_backed_at: string | null; days_held: number | null; conviction: number | null }
    >();
    if (viewer && focusWallets.length > 0) {
      const { data: beliefs } = await sb
        .from("wallet_beliefs")
        .select("wallet, onchain_id, first_backed_at, days_held, conviction")
        .in("wallet", focusWallets)
        .in("onchain_id", marketIds);
      for (const b of beliefs ?? []) {
        beliefByKey.set(`${b.wallet}|${b.onchain_id}`, {
          first_backed_at: b.first_backed_at as string | null,
          days_held: b.days_held as number | null,
          conviction: b.conviction as number | null,
        });
      }
    }

    // 3. Aggregate events per market (network/crowd scale) + per focus-wallet.
    const aggById = new Map<number, MarketAgg>();
    const focusSet = new Set(focusWallets.map((w) => w.toLowerCase()));
    for (const ev of events) {
      const id = ev.onchain_id;
      let agg = aggById.get(id);
      if (!agg) {
        agg = {
          onchain_id: id,
          buckets: { yesIn: 0, yesOut: 0, noIn: 0, noOut: 0 },
          backed: new Set(),
          reduced: new Set(),
          latest: ev.occurred_at,
          byWallet: new Map(),
        };
        aggById.set(id, agg);
      }
      if (ev.occurred_at > agg.latest) agg.latest = ev.occurred_at;
      const usd = eventUsd(ev, stateById.get(id));
      const isBuy = ev.type === "backed";
      const side = ev.side === "YES" ? "YES" : "NO";
      if (isBuy) {
        agg.backed.add(ev.wallet);
        if (side === "YES") agg.buckets.yesIn += usd;
        else agg.buckets.noIn += usd;
      } else {
        agg.reduced.add(ev.wallet);
        if (side === "YES") agg.buckets.yesOut += usd;
        else agg.buckets.noOut += usd;
      }
      const w = ev.wallet.toLowerCase();
      if (focusSet.has(w)) {
        const cur = agg.byWallet.get(w) ?? { side, usdIn: 0, usdOut: 0 };
        cur.side = side;
        if (isBuy) cur.usdIn += usd;
        else cur.usdOut += usd;
        agg.byWallet.set(w, cur);
      }
    }

    // 4. Build candidate cards. One best card per market wins in step 5.
    const now = Date.now();
    const candidates: FeedCard[] = [];

    for (const [id, agg] of aggById) {
      const ms = stateById.get(id);
      const meta = metaById.get(id);
      const title = meta?.title ?? `Market #${id}`;
      const chg = marketChg(ms);
      const ageHours = (now - new Date(agg.latest).getTime()) / 3_600_000;

      // Dominant capital-flow bucket → wealth line + which side the story is about.
      const b = agg.buckets;
      const flows: { usd: number; dir: "in" | "out"; side: Side }[] = [
        { usd: b.yesIn, dir: "in", side: "YES" },
        { usd: b.noIn, dir: "in", side: "NO" },
        { usd: b.yesOut, dir: "out", side: "YES" },
        { usd: b.noOut, dir: "out", side: "NO" },
      ];
      flows.sort((x, y) => y.usd - x.usd);
      const top = flows[0];
      const wealth = top.usd > 0 ? wealthFlow(top.usd, top.dir, top.side) : null;
      const storySide: Side =
        top.usd > 0
          ? top.side
          : ms && (ms.believers_no ?? 0) > (ms.believers_yes ?? 0)
            ? "NO"
            : "YES";
      const newBelievers =
        ms?.new_believers_1h && ms.new_believers_1h > 0 ? ms.new_believers_1h : agg.backed.size;

      // --- (a) Individual card: viewer's People or Opp acted here. Strongest. ---
      let individual: FeedCard | null = null;
      for (const focus of [people, opp]) {
        if (!focus) continue;
        const w = focus.matched_wallet.toLowerCase();
        const acted = agg.byWallet.get(w);
        if (!acted) continue;
        const role = focus === people ? "people" : "opp";
        const belief = beliefByKey.get(`${focus.matched_wallet}|${id}`);
        const firstBacked = belief?.first_backed_at
          ? new Date(belief.first_backed_at).getTime()
          : null;
        const isNew = firstBacked != null && now - firstBacked < 14 * 24 * 3600 * 1000;
        const reducing = acted.usdOut > acted.usdIn;
        const story = reducing
          ? `Reduced their ${acted.side} position.`
          : isNew
            ? `Committed to ${acted.side}.`
            : `Added to their ${acted.side} conviction.`;
        // Opp acting WITH a side they'd usually oppose is surprising; People
        // reducing a shared belief is the loudest signal. Both boost ranking.
        const surprise = role === "opp" ? 0.8 : reducing ? 0.9 : 0.2;
        const daysHeld = belief?.days_held != null ? Math.round(Number(belief.days_held)) : null;
        const context =
          daysHeld && daysHeld >= 14
            ? `held ${daysHeld} days`
            : newBelievers > 0
              ? fmtCount(newBelievers, "new believer")
              : null;
        const usd = reducing ? acted.usdOut : acted.usdIn;
        individual = {
          id: `ind:${w}:${id}`,
          onchain_id: id,
          marketTitle: title,
          wealth: usd > 0 ? wealthFlow(usd, reducing ? "out" : "in", acted.side) : null,
          actor: individualActor(role, focus.matched_wallet, focus.match_score),
          story,
          priceSide: storySide,
          priceChgPct: chg,
          context,
          action: "open",
          signalType: `individual_${role}_${reducing ? "reduce" : "commit"}`,
          score: rankScore({
            wealthUsd: usd,
            attribution: 4,
            meaningful: Math.min(1, belief?.conviction ?? 0),
            surprise,
            ageHours,
          }),
          occurredAt: agg.latest,
        };
        break; // one individual card per market is plenty
      }

      // --- (b) Creator early-signal card: recently authored, in your graph. ---
      let creator: FeedCard | null = null;
      const created = meta?.created_at ? new Date(meta.created_at).getTime() : null;
      if (created != null && now - created < RECENT_CREATE_MS && meta?.author_wallet) {
        creator = {
          id: `creator:${id}`,
          onchain_id: id,
          marketTitle: title,
          wealth,
          actor: creatorActor(meta.author_wallet),
          story:
            agg.backed.size > 1
              ? `Created this market. ${fmtCount(agg.backed.size, "believer")} joined.`
              : `Created a new market. First believer.`,
          priceSide: wealth ? storySide : null,
          priceChgPct: wealth ? chg : null,
          context: wealth ? null : `no money in yet`,
          action: "open",
          signalType: "creator_started",
          score: rankScore({
            wealthUsd: top.usd,
            attribution: 2,
            meaningful: 0.5,
            surprise: 0.4,
            ageHours,
            earlySignal: true,
          }),
          occurredAt: agg.latest,
        };
      }

      // --- (c) Network / crowd card: always available, weakest attribution. ---
      const reduceDominant = top.dir === "out" && top.usd > 0;
      const networkStory = reduceDominant
        ? `${fmtCount(agg.reduced.size, "wallet")} reduced their positions.`
        : newBelievers > 0
          ? `${fmtCount(newBelievers, "new believer")}.`
          : `Capital moved into ${storySide}.`;
      const unattributed = !viewer ? false : true; // network scale isn't "your graph"
      const network: FeedCard = {
        id: `market:${id}`,
        onchain_id: id,
        marketTitle: title,
        wealth,
        // With no honest money figure AND a big move, it's the unattributed tier.
        actor: wealth || !viewer ? marketActor() : null,
        story: wealth
          ? networkStory
          : chg != null && Math.abs(chg) >= BIG_MOVE_PCT
            ? viewer
              ? `Nobody in your graph moved.`
              : `Price moved sharply.`
            : networkStory,
        priceSide: storySide,
        priceChgPct: chg,
        context: null,
        action: "open",
        signalType: wealth ? "market_flow" : "market_unattributed",
        score: rankScore({
          wealthUsd: top.usd,
          attribution: wealth ? 1 : 0,
          meaningful: Math.min(1, newBelievers / 100),
          surprise: 0,
          ageHours,
          unattributed: !wealth && unattributed,
        }),
        occurredAt: agg.latest,
      };

      // Prefer the most attributed story per market: individual > creator > network.
      candidates.push(individual ?? creator ?? network);
    }

    // 5. Rank and cap.
    candidates.sort((a, b) => b.score - a.score);
    return {
      data: candidates.slice(0, MAX_CARDS),
      viewer,
      hasPeople,
      error: null,
    };
  });

// Re-export so the route can build a keyed alias preview without importing the pure module twice.
export { aliasFor };
