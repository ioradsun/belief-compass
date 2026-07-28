/**
 * Market read model — pure metric formulas + the deterministic factual live-line
 * selector. ZERO IO. The single home for every market-level metric DEFINITION, so
 * no surface recomputes believer counts, circulation, people%, velocity or the
 * live line independently. See docs/market-state-metrics.md for the contract.
 *
 * Facts only: nothing here is viewer-specific, ranks markets, or claims an
 * opportunity type. Those belong to Phase 5+.
 */

export const EPSILON = 1e-9;

export type EconSide = "YES" | "NO" | "MIXED" | "INACTIVE";

// ── Participation (canonical positions) ──────────────────────────────────────
/** Directional believers only (YES/NO). MIXED and INACTIVE never count. */
export function peopleYesPct(believersYes: number, believersNo: number): number | null {
  const total = believersYes + believersNo;
  if (total <= 0) return null;
  return (believersYes / total) * 100;
}
export function peopleNoPct(believersYes: number, believersNo: number): number | null {
  const y = peopleYesPct(believersYes, believersNo);
  return y == null ? null : 100 - y;
}
export function directionalBelievers(believersYes: number, believersNo: number): number {
  return believersYes + believersNo;
}

// ── Movement / disagreement ──────────────────────────────────────────────────
/**
 * Divergence = people_yes_pct − yes_percentage, in PERCENTAGE POINTS. Positive
 * means the crowd is more YES than the money. NULL when either input is null.
 */
export function divergencePctPoints(
  peopleYes: number | null,
  moneyYesPct: number | null,
): number | null {
  if (peopleYes == null || moneyYesPct == null) return null;
  return peopleYes - moneyYesPct;
}

// ── Activity (canonical events) ──────────────────────────────────────────────
/**
 * sell_rate = sell_count / max(buy_count + sell_count, 1). A trade-count share
 * (NOT sold-ETH share — that would be a separately named field).
 */
export function sellRate(buyCount: number, sellCount: number): number {
  return sellCount / Math.max(buyCount + sellCount, 1);
}
export function buySellRatio(buyCount: number, sellCount: number): number {
  return buyCount / Math.max(sellCount, 1);
}

/**
 * circulation_window = canonical trade volume in the window ÷ max(total current
 * market capital, epsilon). A dimensionless turnover rate. Zero/absent capital ⇒
 * null (undefined turnover), never Infinity. Volume and capital MUST share units
 * (both USD, or both ETH-converted) — the caller supplies matched units.
 */
export function circulation(volumeInWindow: number, totalCapital: number | null): number | null {
  if (totalCapital == null || totalCapital <= EPSILON) return null;
  return volumeInWindow / totalCapital;
}

// ── Lifecycle ────────────────────────────────────────────────────────────────
export function marketAgeDays(createdAt: string | null, now: number): number | null {
  if (!createdAt) return null;
  return Math.max(0, (now - new Date(createdAt).getTime()) / 86_400_000);
}
export function inactiveForSeconds(lastTradeAt: string | null, now: number): number | null {
  if (!lastTradeAt) return null;
  return Math.max(0, Math.floor((now - new Date(lastTradeAt).getTime()) / 1000));
}

// ── Position transitions (durable participation facts) ───────────────────────
export type TransitionKind =
  | "position_became_directional"
  | "position_changed_side"
  | "position_became_mixed"
  | "position_became_inactive";

/**
 * The transition (if any) between a position's previous and new evaluated side.
 * A NEW BELIEVER is exactly position_became_directional (INACTIVE/MIXED → YES/NO).
 * A SIDE FLIP is position_changed_side (YES↔NO) and is NOT a new believer.
 * Same-side moves and INACTIVE↔MIXED are not transitions.
 */
export function transitionKind(prev: EconSide, next: EconSide): TransitionKind | null {
  const prevDir = prev === "YES" || prev === "NO";
  const nextDir = next === "YES" || next === "NO";
  if (!prevDir && nextDir) return "position_became_directional";
  if (prevDir && nextDir && prev !== next) return "position_changed_side";
  if (prevDir && next === "MIXED") return "position_became_mixed";
  if (prevDir && next === "INACTIVE") return "position_became_inactive";
  return null;
}
export function isNewBeliever(prev: EconSide, next: EconSide): boolean {
  return transitionKind(prev, next) === "position_became_directional";
}

// ── Live line (deterministic factual summary) ────────────────────────────────
export type Window = "1h" | "24h" | "7d" | "all";

export interface LiveLineInput {
  now: number;
  // New directional believers (from position transitions), per window + side split.
  newBelievers: { "1h": number; "24h": number; "7d": number };
  newBelieversSide: "YES" | "NO" | null; // dominant side among recent new believers
  // Volume (USD) per window (canonical events × price).
  volumeUsd: { "1h": number; "24h": number; "7d": number };
  tradeCount: { "1h": number; "24h": number; "7d": number };
  buyCount24h: number;
  sellCount24h: number;
  directionalBelievers: number;
  directionalBelieversMilestone: number | null; // a round threshold just crossed, else null
  peopleYesCrossed: "YES_over_NO" | "NO_over_YES" | null; // people% crossed 50 in 24h
  peopleYesCrossedAt: string | null;
  firstTradeAt: string | null;
  lastTradeAt: string | null;
  isFirstTrade: boolean; // exactly one canonical trade ever
}

export interface LiveLine {
  line: string;
  kind: string;
  window: Window;
  occurredAt: string | null;
  payload: Record<string, unknown>;
}

function usd(n: number): string {
  return (
    "$" +
    (n >= 1000
      ? n.toLocaleString("en-US", { maximumFractionDigits: 0 })
      : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
  );
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

interface Candidate extends LiveLine {
  priority: number; // higher wins; deterministic tie-break by kind then window
  supported: boolean;
}

/**
 * Choose the single most important CURRENT factual line, using the evidence
 * ladder 1h → 24h → 7d → all-time milestone. Priority order: meaningful change,
 * breadth, magnitude, recency, novelty. Returns null when no candidate has
 * supporting structured evidence (never fabricate a line). The exact window used
 * is always recorded, so 7d evidence is never presented as "this hour".
 */
export function selectLiveLine(i: LiveLineInput): LiveLine | null {
  const c: Candidate[] = [];

  // (1) Meaningful change: people% crossed the 50% line (an overtake).
  if (i.peopleYesCrossed) {
    const [a, b] = i.peopleYesCrossed === "NO_over_YES" ? ["NO", "YES"] : ["YES", "NO"];
    c.push({
      priority: 100,
      supported: true,
      kind: "side_overtake",
      window: "24h",
      line: `${a} overtook ${b}.`,
      occurredAt: i.peopleYesCrossedAt,
      payload: { crossed: i.peopleYesCrossed, at: i.peopleYesCrossedAt },
    });
  }

  // (2) Breadth: new directional believers, on the evidence ladder.
  const nbWindow: Window | null =
    i.newBelievers["1h"] > 0
      ? "1h"
      : i.newBelievers["24h"] > 0
        ? "24h"
        : i.newBelievers["7d"] > 0
          ? "7d"
          : null;
  if (nbWindow) {
    const n = i.newBelievers[nbWindow];
    const sideTxt = i.newBelieversSide ? ` ${i.newBelieversSide}` : "";
    const label =
      nbWindow === "1h" ? "in the last hour" : nbWindow === "24h" ? "today" : "in the last 7 days";
    c.push({
      priority: nbWindow === "1h" ? 90 : nbWindow === "24h" ? 70 : 50,
      supported: true,
      kind: "new_believers",
      window: nbWindow,
      line: `${plural(n, "believer")} backed${sideTxt} ${label}.`,
      occurredAt: i.lastTradeAt,
      payload: {
        window: nbWindow,
        wallets: n,
        side: i.newBelieversSide,
        trade_count: i.tradeCount[nbWindow],
      },
    });
  }

  // (3) Magnitude: capital entered, on the evidence ladder.
  const volWindow: Window | null =
    i.volumeUsd["1h"] > 0
      ? "1h"
      : i.volumeUsd["24h"] > 0
        ? "24h"
        : i.volumeUsd["7d"] > 0
          ? "7d"
          : null;
  if (volWindow) {
    const v = i.volumeUsd[volWindow];
    const label =
      volWindow === "1h" ? "the last hour" : volWindow === "24h" ? "today" : "the last 7 days";
    c.push({
      priority: volWindow === "1h" ? 65 : volWindow === "24h" ? 55 : 40,
      supported: v > 0,
      kind: "capital_flow",
      window: volWindow,
      line: `${usd(v)} traded in ${label}.`,
      occurredAt: i.lastTradeAt,
      payload: { window: volWindow, volume_usd: v, trade_count: i.tradeCount[volWindow] },
    });
  }

  // (4) Recency/novelty: selling rose (today), a believer milestone, first trade.
  if (i.buyCount24h + i.sellCount24h >= 5) {
    const sr = sellRate(i.buyCount24h, i.sellCount24h);
    if (sr >= 0.4) {
      c.push({
        priority: 45,
        supported: true,
        kind: "sell_pressure",
        window: "24h",
        line: `Selling rose to ${Math.round(sr * 100)}% of trades today.`,
        occurredAt: i.lastTradeAt,
        payload: {
          window: "24h",
          sell_rate: sr,
          buy_count: i.buyCount24h,
          sell_count: i.sellCount24h,
        },
      });
    }
  }
  if (i.directionalBelieversMilestone != null) {
    c.push({
      priority: 60,
      supported: true,
      kind: "believer_milestone",
      window: "all",
      line: `The market reached ${i.directionalBelieversMilestone} directional believers.`,
      occurredAt: i.lastTradeAt,
      payload: {
        milestone: i.directionalBelieversMilestone,
        directional_believers: i.directionalBelievers,
      },
    });
  }
  if (i.isFirstTrade) {
    c.push({
      priority: 30,
      supported: true,
      kind: "first_trade",
      window: "all",
      line: `This market recorded its first trade.`,
      occurredAt: i.firstTradeAt,
      payload: { first_trade_at: i.firstTradeAt },
    });
  }

  const viable = c.filter((x) => x.supported);
  if (viable.length === 0) return null;
  viable.sort(
    (a, b) => b.priority - a.priority || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0),
  );
  const w = viable[0];
  return {
    line: w.line,
    kind: w.kind,
    window: w.window,
    occurredAt: w.occurredAt,
    payload: w.payload,
  };
}

/** The largest round believer threshold at or below n (for milestone detection). */
export function believerMilestoneAtOrBelow(n: number): number | null {
  const rungs = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
  let hit: number | null = null;
  for (const r of rungs) if (n >= r) hit = r;
  return hit;
}
