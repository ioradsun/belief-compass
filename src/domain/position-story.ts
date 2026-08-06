/**
 * Position story — the OWNER'S view of the platform's canonical market narrative.
 *
 * This module deliberately does NOT compute a second narrative. The single
 * source of truth for "what is happening in this market" is the live line
 * selected by src/lib/market-state/read-model.ts (`selectLiveLine`) and stored
 * on `market_state.live_line{,_kind,_window,_payload}` — the same line the feed,
 * the market panel and the recommendation surfaces read. Here we only:
 *
 *   1. take the viewer's own network arrivals on that market (Twin / Tribe / Opp,
 *      already produced by the live tape) — those outrank everything for an owner;
 *   2. otherwise take the CANONICAL line and re-tell it from the owner's seat:
 *      the same event, phrased as "your side" vs "the other side";
 *   3. rank the result, so the convictions where something actually happened rise
 *      to the top of the panel.
 *
 * Nothing here derives momentum, price moves, or capital flow. The previous
 * version did: it read a per-window price % that is a near-uniform valuation
 * artifact across all markets, so almost every card printed "Money is moving
 * into YES without new believers" and flip-flopped as that number drifted. That
 * whole branch is gone — a story is only told when the read model has evidence
 * for it.
 *
 * ZERO IO, pure, fully testable.
 */

export type Side = "YES" | "NO";

/** The one story a card tells, in priority order (also its urgency rank). */
export type StoryKind =
  | "twin"
  | "tribe"
  | "opp"
  | "side_overtake"
  | "milestone"
  | "believers_your_side"
  | "believers_other_side"
  | "believers"
  | "selling"
  | "capital"
  | "first_trade"
  | "early"
  | "quiet";

export const STORY_RANK: Record<StoryKind, number> = {
  twin: 100,
  tribe: 90,
  opp: 80,
  side_overtake: 75,
  milestone: 70,
  believers_your_side: 65,
  believers_other_side: 60,
  believers: 55,
  selling: 45,
  capital: 40,
  first_trade: 30,
  early: 15,
  quiet: 0,
};

export type StoryTone = "up" | "down" | "neutral" | "muted";

export interface PositionStory {
  kind: StoryKind;
  /** The one-sentence reason to open the market — the card's footer. */
  headline: string;
  /** Optional supporting line. */
  body?: string;
  tone: StoryTone;
}

/**
 * The canonical market line, exactly as the read model stored it. Passed straight
 * through from `market_state`; never recomputed on the client.
 */
export interface CanonicalLine {
  line: string | null;
  kind: string | null;
  window?: string | null;
  payload?: Record<string, unknown> | null;
  /** When the read model observed it. Used only to refuse a stale line. */
  occurredAt?: string | null;
}

export interface PositionStoryInput {
  side: Side;
  /** Believers on the held side, now. */
  believers: number | null;
  /** The canonical market narrative for this market (single source of truth). */
  live?: CanonicalLine | null;
  /**
   * Network activity on THIS market, from the live tape. A side when we know
   * which way they went, `true` when we only know they moved.
   */
  net?: { twin?: Side | true; tribe?: Side | true; opp?: Side | true };
  /** A believer milestone this market just crossed, from the tape (or null). */
  milestone?: number | null;
  /** Now, for the staleness check. Defaults to the caller's clock. */
  nowMs?: number;
}

/** Below this many believers a side is still forming — "still early". */
export const EARLY_BELIEVERS = 10;

const HOUR = 3_600_000;

/**
 * How long a canonical line may still be told on a position card, per the window
 * it was measured over. The read model keeps the last line on the row until a new
 * one wins, so a dormant market can carry a line for days — and "6 people joined
 * YES today" is a lie the moment "today" has passed. Each window gets roughly
 * twice its own span before the card falls back to the standing state.
 */
export const LINE_MAX_AGE_MS: Record<string, number> = {
  "1h": 6 * HOUR,
  "24h": 48 * HOUR,
  "7d": 10 * 24 * HOUR,
  all: 14 * 24 * HOUR,
};
const LINE_MAX_AGE_DEFAULT_MS = 48 * HOUR;

/**
 * Is the canonical line still true enough to tell? Unknown timestamps pass — the
 * read model always writes one, so a missing value means an older row, not a
 * stale story, and silencing every such card would be the worse failure.
 */
export function isLineFresh(live: CanonicalLine, nowMs: number = Date.now()): boolean {
  if (!live.occurredAt) return true;
  const t = new Date(live.occurredAt).getTime();
  if (!Number.isFinite(t)) return true;
  const max = LINE_MAX_AGE_MS[String(live.window ?? "")] ?? LINE_MAX_AGE_DEFAULT_MS;
  return nowMs - t <= max;
}

const WINDOW_PHRASE: Record<string, string> = {
  "1h": "in the last hour",
  "24h": "today",
  "7d": "in the last 7 days",
  all: "so far",
};

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const sideOf = (v: unknown): Side | null => (v === "YES" || v === "NO" ? v : null);
const other = (s: Side): Side => (s === "YES" ? "NO" : "YES");
const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

/**
 * Re-tell the canonical line from the owner's seat. Returns null when the read
 * model has no line, or when its kind carries nothing an owner should be pulled
 * back for — the caller then falls back to the standing state of their side.
 */
function ownerViewOfCanonical(
  side: Side,
  live: CanonicalLine,
  believers: number | null,
): PositionStory | null {
  const kind = live.kind ?? "";
  const p = live.payload ?? {};
  const win = WINDOW_PHRASE[String(live.window ?? "")] ?? "recently";

  if (kind === "side_overtake") {
    const crossed = String((p as { crossed?: unknown }).crossed ?? "");
    const leader: Side | null = crossed.startsWith("YES")
      ? "YES"
      : crossed.startsWith("NO")
        ? "NO"
        : null;
    if (leader) {
      const mine = leader === side;
      return {
        kind: "side_overtake",
        headline: mine
          ? `${side} just became the majority.`
          : `${leader} just overtook ${side}.`,
        body: mine ? "More people now stand where you stand." : undefined,
        tone: mine ? "up" : "down",
      };
    }
  }

  if (kind === "believer_milestone") {
    const m = num((p as { milestone?: unknown }).milestone);
    if (m != null && m > 0)
      return {
        kind: "milestone",
        headline: `This market just reached ${m.toLocaleString("en-US")} believers.`,
        tone: "up",
      };
  }

  if (kind === "new_believers") {
    const n = num((p as { wallets?: unknown }).wallets) ?? 0;
    if (n > 0) {
      const s = sideOf((p as { side?: unknown }).side);
      if (s === side)
        return {
          kind: "believers_your_side",
          headline: `${people(n)} joined ${side} ${win}.`,
          body:
            believers != null ? `${believers.toLocaleString("en-US")} now back ${side}.` : undefined,
          tone: "up",
        };
      if (s === other(side))
        return {
          kind: "believers_other_side",
          headline: `${people(n)} backed ${s} ${win}.`,
          body: "The other side of your conviction is filling up.",
          tone: "down",
        };
      return {
        kind: "believers",
        headline: `${people(n)} backed a side ${win}.`,
        tone: "neutral",
      };
    }
  }

  if (kind === "sell_pressure") {
    const rate = num((p as { sell_rate?: unknown }).sell_rate);
    return {
      kind: "selling",
      headline:
        rate != null
          ? `Selling rose to ${Math.round(rate * 100)}% of trades today.`
          : "Selling picked up today.",
      tone: "down",
    };
  }

  if (kind === "capital_flow") {
    // Factual only: the read model knows money moved, not who it favoured. The
    // old copy claimed "money is moving into YES", which it never had evidence for.
    return {
      kind: "capital",
      headline: live.line ? `Money moved here — ${lowerFirst(live.line)}` : `Money moved here ${win}.`,
      tone: "neutral",
    };
  }

  if (kind === "first_trade")
    return {
      kind: "first_trade",
      headline: "This market just recorded its first trade.",
      tone: "neutral",
    };

  return null;
}

const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

/**
 * The one story for a card, chosen by what matters most to an OWNER: their people
 * arriving, then the canonical market line seen from their side, then the standing
 * state of that side.
 */
export function positionStory(input: PositionStoryInput): PositionStory {
  const { side, believers } = input;
  const net = input.net ?? {};

  // 1–3 — your people arrived, and WHICH WAY when we know. On your own position
  // card that is the whole signal: your Twin agreeing with you and your Twin
  // taking the other side are opposite news.
  const way = (v: Side | true | undefined): Side | null => (typeof v === "string" ? v : null);
  const agrees = (s: Side | null) => (s == null ? null : s === side);
  if (net.twin) {
    const s = way(net.twin);
    return {
      kind: "twin",
      headline: s
        ? `Your Conviction Twin just backed ${s}.`
        : "Your Conviction Twin just entered this market.",
      body: agrees(s) === false ? "Your closest match is on the other side of you." : undefined,
      tone: "up",
    };
  }
  if (net.tribe) {
    const s = way(net.tribe);
    return {
      kind: "tribe",
      headline: s ? `Your Tribe is backing ${s} here.` : "Your Tribe is becoming active here.",
      body: s ? undefined : "Someone you move with just entered.",
      tone: "up",
    };
  }
  if (net.opp) {
    const s = way(net.opp);
    return {
      kind: "opp",
      headline: s
        ? `Your strongest Opp just backed ${s}.`
        : "Your strongest Opp entered this market.",
      tone: "neutral",
    };
  }

  // 4 — a milestone the tape saw directly.
  if (input.milestone != null)
    return {
      kind: "milestone",
      headline: `This market just reached ${input.milestone.toLocaleString("en-US")} believers.`,
      tone: "up",
    };

  // 5 — THE CANONICAL MARKET STORY, told from the owner's seat — but only while
  // it is still true. A stale line is worse than no line: it invents news.
  if (input.live && isLineFresh(input.live, input.nowMs ?? Date.now())) {
    const s = ownerViewOfCanonical(side, input.live, believers);
    if (s) return s;
  }

  // 6 — no canonical evidence: the standing state of your side.
  if (believers != null && believers > 0 && believers < EARLY_BELIEVERS)
    return {
      kind: "early",
      headline:
        believers === 1
          ? `You are the only believer on ${side} so far.`
          : `Only ${believers.toLocaleString("en-US")} people back ${side} so far.`,
      tone: "muted",
    };
  if (believers != null && believers > 0)
    return {
      kind: "quiet",
      headline: `Nothing changed today — ${believers.toLocaleString("en-US")} still back ${side}.`,
      tone: "muted",
    };
  return { kind: "quiet", headline: "Nothing has changed here today.", tone: "muted" };
}

export interface PositionSignal {
  story: PositionStory;
  /** Higher = more deserving of the top of the list. */
  urgency: number;
}

/** Everything a card needs to render + its rank for sorting by "what's alive". */
export function positionSignal(input: PositionStoryInput): PositionSignal {
  const story = positionStory(input);
  return { story, urgency: STORY_RANK[story.kind] };
}
