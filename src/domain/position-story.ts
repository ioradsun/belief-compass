/**
 * Position line — the OWNER'S reading of the platform's canonical market fact.
 *
 * This module computes NO intelligence. The single source of truth for "what is
 * happening in this market" is the line selected by
 * src/lib/market-state/read-model.ts (`selectLiveLine`) and persisted on
 * `market_state.live_line{,_kind,_window,_payload}` — the same fact every other
 * market surface reads. Here we only re-phrase it from the holder's seat: the
 * same event, said as "your side" vs "the other side".
 *
 * WHAT WAS REMOVED, AND WHY
 *
 *  • STORY_RANK — a second editorial hierarchy. Positions ranked the holder's
 *    money by how newsworthy a sentence was. A portfolio answers "where is my
 *    money", so the list is now sorted by position value. There is no urgency
 *    score, no attention score, and nothing to replace it with.
 *  • Twin / Tribe / Opp / milestone — these were reconstructed on the client by
 *    scanning raw tape events, i.e. Positions interpreting the feed to decide
 *    what a market meant. Network intelligence belongs to the Insider pipeline;
 *    Positions does not re-derive it.
 *  • "Still early" / "Nothing changed today" — filler that occupied the line
 *    whenever there was no fact. A position card does not require commentary.
 *    With no material persisted fact this returns null and the card is quiet.
 *
 * Materiality is NOT decided here: `liveLineIsMaterial` is the producer's own
 * rule, read from the persisted kind + window. Positions cannot alter, upgrade
 * or reinterpret the factual meaning of a line — only whose seat it is told from.
 *
 * ZERO IO, pure, fully testable.
 */
import { liveLineIsMaterial } from "@/lib/market-state/read-model";

export type Side = "YES" | "NO";

/** The one line a card may tell. Each maps 1:1 to a canonical `live_line_kind`. */
export type StoryKind =
  | "side_overtake"
  | "milestone"
  | "believers_your_side"
  | "believers_other_side"
  | "believers"
  | "selling"
  | "capital"
  | "first_trade";

export type StoryTone = "up" | "down" | "neutral" | "muted";

export interface PositionStory {
  kind: StoryKind;
  /** The one-sentence fact, in the owner's voice — the card's footer. */
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
  /** Net holder change over the selected window, from authoritative snapshots. */
  believerDelta?: number | null;
  /** The canonical market narrative for this market (single source of truth). */
  live?: CanonicalLine | null;
  /** Now, for the staleness check. Defaults to the caller's clock. */
  nowMs?: number;
}

const HOUR = 3_600_000;

/**
 * How long a canonical line may still be told on a position card, per the window
 * it was measured over. The read model keeps the last line on the row until a new
 * one wins, so a dormant market can carry a line for days — and "6 people joined
 * YES today" is a lie the moment "today" has passed. Each window gets roughly
 * twice its own span before the card falls silent.
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
const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s);

/**
 * Re-tell the canonical line from the owner's seat. Returns null when its kind
 * carries nothing an owner should be pulled back for — the card then says nothing.
 */
function ownerViewOfCanonical(
  side: Side,
  live: CanonicalLine,
  believers: number | null,
  believerDelta: number | null,
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
        headline: mine ? `${side} just became the majority.` : `${leader} just overtook ${side}.`,
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
      // `wallets` is gross first-time arrivals. It is not a side history until
      // the snapshot delta can reconcile it with exits/flips. Lead with net;
      // gross is supporting context only when both measures are available.
      if (s === side && believerDelta != null && believerDelta !== 0) {
        const d = Math.abs(believerDelta);
        return {
          kind: "believers_your_side",
          headline:
            believerDelta > 0
              ? `${side} gained ${people(d)} ${win}.`
              : `${side} lost ${people(d)} ${win}.`,
          body: `${people(n)} joined${believerDelta < n ? ", but even more left or flipped" : ""}. ${believers == null ? "" : `${believers.toLocaleString("en-US")} now back ${side}.`}`.trim(),
          tone: believerDelta > 0 ? "up" : "down",
        };
      }
      if (s === side) return null;
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
    // Factual only: the read model knows money moved, not who it favoured.
    return {
      kind: "capital",
      headline: live.line
        ? `Money moved here — ${lowerFirst(live.line)}`
        : `Money moved here ${win}.`,
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

/**
 * The optional line for a card: the persisted canonical fact, re-told from the
 * holder's seat — but only while it is both MATERIAL (the producer's own rule)
 * and still TRUE (its window has not aged out). Otherwise null: silence.
 */
export function positionStory(input: PositionStoryInput): PositionStory | null {
  const live = input.live;
  if (!live) return null;
  if (!liveLineIsMaterial(live.kind, live.window)) return null;
  if (!isLineFresh(live, input.nowMs ?? Date.now())) return null;
  return ownerViewOfCanonical(
    input.side,
    live,
    input.believers,
    input.believerDelta ?? null,
  );
}
