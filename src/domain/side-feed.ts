/**
 * SIDE FEED — the anatomy of ONE side, told chronologically.
 *
 * The Case File panels answer "what is happening to YES?" / "…to NO?": is this
 * side gaining believers, capital, or price, and is the move broad or one wallet?
 * This turns the per-side trade tape into a short feed of side-native beats:
 *
 *     4 believers joined YES · YES now has 18 believers
 *     $420 left NO · NO now holds $815
 *     3 members of your Tribe joined YES
 *
 * It REUSES the one importance engine (feed-event.ts) to decide which beats are
 * meaningful and how loud (tier) — no parallel scoring model. Related trades are
 * consolidated into 15-minute beats (the same buckets the timeline rail uses), so
 * three adjacent buys read as one flow, and raw trades stay in the ledger. Order
 * is chronological and never re-sorted by score — tier drives visibility and
 * emphasis, not sequence.
 *
 * ZERO IO, pure, fully testable. Money arrives in ETH; the caller passes a
 * formatter, so copy stays unit-agnostic (like side-lens and position-story).
 */
import {
  compareTape,
  RAIL_BUCKET_MS,
  BELIEVER_MILESTONES,
  WHALE_MULTIPLE,
} from "./conviction-series";
import type { TapeTrade } from "./conviction-series";
import { FLOW_WINDOW_MS, type FlowWindow } from "./market-flow";
import {
  includeInFeed,
  scoreFeedEvent,
  type FeedDimension,
  type FeedTier,
  type NetTag,
} from "./feed-event";

export type SideFeedTone = "up" | "down" | "neutral";

export interface SideFeedItem {
  id: string;
  t: number;
  tier: FeedTier;
  dimension: FeedDimension;
  tone: SideFeedTone;
  emoji: string;
  /** What changed — the side-native lead ("4 believers joined YES"). */
  headline: string;
  /** Current state, attached only to the most recent beat of each dimension so
   *  it isn't repeated down the list ("YES now has 18 believers"). */
  current: string | null;
}

export interface SideFeedInput {
  /** Full known market tape (any order) so pre-window totals are real. */
  trades: TapeTrade[];
  side: "YES" | "NO";
  win: FlowWindow;
  nowMs: number;
  /** USD rate — makes magnitude market-relative and gates dust. */
  ethUsd: number;
  /** Directional believers on the WHOLE market (yes+no) — the market-size proxy. */
  marketBelievers?: number | null;
  /** wallet(lowercased) → the viewer's relationship with them, when in-network. */
  network?: Map<string, NetTag>;
  /** Current side totals, for the "current state" lines. */
  believersNow: number;
  capitalEthNow: number;
  /** ETH → the viewer's display unit. */
  money: (eth: number) => string;
  /** Max beats to return (newest first). */
  limit?: number;
}

/** The label the viewer knows a relationship by (opp reads as "Rival"). */
const GROUP_LABEL: Record<NetTag, string> = {
  twin: "Twin",
  tribe: "Tribe",
  opp: "Rival",
  inverse: "Opp",
};
const REL_RANK: Record<NetTag, number> = { twin: 4, opp: 3, tribe: 2, inverse: 1 };

const strongest = (tags: NetTag[]): NetTag | null =>
  tags.length ? tags.reduce((a, b) => (REL_RANK[b] > REL_RANK[a] ? b : a)) : null;

interface Bucket {
  t: number;
  newBelievers: number;
  newWallets: string[];
  buyEth: number;
  sellEth: number;
  tradeWallets: Set<string>;
  minT: number;
  maxT: number;
}

/** "in 20 minutes" when a beat genuinely spans time, else "". */
function spanPhrase(minT: number, maxT: number): string {
  const mins = Math.round((maxT - minT) / 60_000);
  return mins >= 2 ? ` in ${mins} minutes` : "";
}

/**
 * Build the side feed. Walks the side's in-window trades into 15-minute beats,
 * scores each beat with the shared engine, and emits the meaningful ones
 * (people, capital) plus structural beats (whales, milestones), newest first.
 */
export function sideFeed(input: SideFeedInput): SideFeedItem[] {
  const {
    trades,
    side,
    win,
    nowMs,
    ethUsd,
    marketBelievers = null,
    network,
    believersNow,
    capitalEthNow,
    money,
    limit = 5,
  } = input;

  const since = win === "all" ? -Infinity : nowMs - FLOW_WINDOW_MS[win];
  const all = trades.filter((t) => t.side === side && Number.isFinite(t.t)).sort(compareTape);

  // Believer count and roster entering the window, so milestones are truthful and
  // a wallet that joined before the window isn't recounted as "new".
  const seen = new Set<string>();
  for (const t of all) {
    if (t.t >= since) break;
    if (t.action === "BUY") seen.add(t.w);
  }
  let believers = seen.size;

  const inWin = all.filter((t) => t.t >= since);
  const buys = inWin.filter((t) => t.action === "BUY" && t.eth > 0).map((t) => t.eth);
  const median = buys.length ? [...buys].sort((a, b) => a - b)[Math.floor(buys.length / 2)] : 0;
  const whaleFloor = median > 0 ? median * WHALE_MULTIPLE : Infinity;

  const rel = (w: string): NetTag | null => network?.get(w.toLowerCase()) ?? null;

  const items: SideFeedItem[] = [];
  const buckets = new Map<number, Bucket>();

  for (const t of inWin) {
    const key = Math.floor(t.t / RAIL_BUCKET_MS) * RAIL_BUCKET_MS;
    const b =
      buckets.get(key) ??
      ({
        t: key,
        newBelievers: 0,
        newWallets: [],
        buyEth: 0,
        sellEth: 0,
        tradeWallets: new Set(),
        minT: t.t,
        maxT: t.t,
      } as Bucket);
    b.minT = Math.min(b.minT, t.t);
    b.maxT = Math.max(b.maxT, t.t);
    b.tradeWallets.add(t.w);

    if (t.action === "BUY") {
      if (!seen.has(t.w)) {
        seen.add(t.w);
        believers += 1;
        b.newBelievers += 1;
        b.newWallets.push(t.w);
        for (const m of BELIEVER_MILESTONES) {
          if (believers === m) {
            const c = {
              kind: "believer_milestone",
              side,
              amountUsd: null,
              walletCount: 1,
              tradeCount: 1,
              marketBelievers,
            };
            const s = scoreFeedEvent(c);
            items.push({
              id: `mile-${side}-${m}`,
              t: t.t,
              tier: s.tier,
              dimension: "people",
              tone: "up",
              emoji: "🏆",
              headline: `${side} reached ${m} believers`,
              current: null,
            });
          }
        }
      }
      // An outsized single buy is its own beat — never folded into the flow.
      if (t.eth >= whaleFloor) {
        const relationship = rel(t.w);
        const c = {
          kind: "large_trade",
          side,
          amountUsd: t.eth * ethUsd,
          walletCount: 1,
          tradeCount: 1,
          relationship,
          marketBelievers,
        };
        const s = scoreFeedEvent(c);
        if (includeInFeed(c)) {
          const who = relationship ? `Your ${GROUP_LABEL[relationship]}` : "One investor";
          items.push({
            id: `whale-${side}-${t.t}-${t.w}`,
            t: t.t,
            tier: s.tier,
            dimension: relationship ? "social" : "capital",
            tone: "up",
            emoji: "🐋",
            headline: `${who} backed ${side} with ${money(t.eth)}`,
            current: null,
          });
        }
      } else {
        b.buyEth += t.eth;
      }
    } else {
      b.sellEth += t.eth;
    }
    buckets.set(key, b);
  }

  // People and capital beats, one each per bucket, gated by importance.
  for (const b of buckets.values()) {
    if (b.newBelievers > 0) {
      const tag = strongest(b.newWallets.map(rel).filter((x): x is NetTag => x !== null));
      const c = {
        kind: "trade_burst",
        side,
        amountUsd: b.buyEth * ethUsd,
        walletCount: b.newBelievers,
        tradeCount: b.newBelievers,
        windowMs: RAIL_BUCKET_MS,
        relationship: tag,
        marketBelievers,
      };
      const s = scoreFeedEvent(c);
      if (includeInFeed(c)) {
        items.push({
          id: `bel-${side}-${b.t}`,
          t: b.maxT,
          tier: s.tier,
          dimension: tag ? "social" : "people",
          tone: "up",
          emoji: "👥",
          headline: believerHeadline(side, b.newBelievers, tag, spanPhrase(b.minT, b.maxT)),
          current: null,
        });
      }
    }

    const netEth = b.buyEth - b.sellEth;
    if (Math.abs(netEth) > 0) {
      const inflow = netEth > 0;
      const c = {
        kind: "trade_burst",
        side,
        amountUsd: Math.abs(netEth) * ethUsd,
        walletCount: b.tradeWallets.size,
        tradeCount: b.tradeWallets.size,
        windowMs: RAIL_BUCKET_MS,
        relationship: null,
        marketBelievers,
      };
      const s = scoreFeedEvent(c);
      if (includeInFeed(c)) {
        items.push({
          id: `cap-${side}-${b.t}`,
          t: b.maxT,
          tier: s.tier,
          dimension: "capital",
          tone: inflow ? "up" : "down",
          emoji: inflow ? "💰" : "↩",
          headline: `${money(Math.abs(netEth))} ${inflow ? "entered" : "left"} ${side}${spanPhrase(b.minT, b.maxT)}`,
          current: null,
        });
      }
    }
  }

  // Newest first — chronological, NEVER re-sorted by score.
  items.sort((a, b) => b.t - a.t);

  // Attach the current state to the most recent beat of each dimension only.
  const currentFor = (d: FeedDimension): string | null => {
    if (d === "people" || d === "social")
      return `${side} now has ${believersNow.toLocaleString("en-US")} believer${believersNow === 1 ? "" : "s"}`;
    if (d === "capital") return `${side} now holds ${money(capitalEthNow)}`;
    return null;
  };
  const shown = new Set<FeedDimension>();
  for (const it of items) {
    const dim: FeedDimension = it.dimension === "social" ? "people" : it.dimension;
    if (!shown.has(dim)) {
      it.current = currentFor(it.dimension);
      shown.add(dim);
    }
  }

  return items.slice(0, limit);
}

/** Side-native believer copy, social when your people drove it. */
function believerHeadline(side: "YES" | "NO", n: number, tag: NetTag | null, span: string): string {
  if (tag === "twin") return `Your Twin joined ${side}`;
  if (tag && n === 1) return `Your ${GROUP_LABEL[tag]} joined ${side}`;
  if (tag && (tag === "tribe" || tag === "opp"))
    return `${n} members of your ${GROUP_LABEL[tag]} joined ${side}${span}`;
  return `${n} believer${n === 1 ? "" : "s"} joined ${side}${span}`;
}
