/**
 * TRANSITION COPY — composed from STRUCTURED FACTS, never from stored prose.
 *
 * A market transition is persisted as an event, and for a long time the SENTENCE
 * was persisted with it. That froze the product's voice at emit time: rows
 * written months ago still say "YES IS GETTING LIGHTER / Some of what was behind
 * it walked", and no amount of read-time retelling can fix copy whose facts were
 * thrown away. Worse, it is a TRUST problem — the reader is shown a sentence the
 * current system cannot verify against the current numbers.
 *
 * So the payload's `headline`/`detail` are no longer read anywhere. This module
 * re-derives the sentence from the fields that are actually structured — the
 * transition TYPE, its SIDE, which METRIC moved and which DIRECTION — combined
 * with the market's live numbers. Say only what the numbers support; when they
 * do not support anything, suppress the row rather than narrate a shape.
 *
 * The denominator discipline from `transition-denominator` is kept: a capital
 * claim we cannot size, or one sized in pocket change, is not printed.
 *
 * ZERO IO, pure, deterministic.
 */
import { DUST_USD, MATERIAL_USD, type CopyLevel } from "./transition-denominator";

export type TransitionSide = "YES" | "NO" | null;

/** Everything a transition row may speak from. Numbers, never sentences. */
export interface TransitionFacts {
  /** The persisted StoryEventType. Unknown/absent → nothing may be said. */
  type: string | null;
  side: TransitionSide;
  /** Which measurement moved, as the emitter recorded it. */
  metric?: "capital" | "price" | "believers" | null;
  direction?: "up" | "down" | null;
  /** This side's 24h capital movement in USD, signed. The denominator. */
  capitalDeltaUsd?: number | null;
  /** This side's proven 24h relative price move (+0.09 = up 9%). */
  pricePct?: number | null;
  believersYes?: number | null;
  believersNo?: number | null;
}

export interface ComposedTransition {
  headline: string;
  detail: string;
  level: CopyLevel;
  /** True when the facts cannot support a printable row. */
  suppress: boolean;
}

const num = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

const other = (side: "YES" | "NO"): "YES" | "NO" => (side === "YES" ? "NO" : "YES");

function money(usd: number): string {
  const v = Math.abs(usd);
  if (v >= 1000) return `$${Math.round(v).toLocaleString("en-US")}`;
  if (v >= 100) return `$${Math.round(v)}`;
  if (v >= 10) return `$${v.toFixed(0)}`;
  return `$${v.toFixed(2)}`;
}

const pct = (rel: number): string => `${Math.round(Math.abs(rel) * 100)}%`;
const people = (n: number): string => `${n} ${n === 1 ? "person" : "people"}`;

const NOTHING: ComposedTransition = {
  headline: "",
  detail: "",
  level: "receipt",
  suppress: true,
};

/** The believer split, when both halves are known. */
function split(f: TransitionFacts): string | null {
  const y = num(f.believersYes);
  const n = num(f.believersNo);
  if (y == null || n == null) return null;
  return `${people(y)} on YES, ${people(n)} on NO.`;
}

/**
 * A capital sentence, with its denominator in view. Returns null when the money
 * cannot be sized or is pocket change — both of which mean "do not print".
 */
function capitalLine(f: TransitionFacts, it: string): ComposedTransition | null {
  const usd = num(f.capitalDeltaUsd);
  if (usd == null || Math.abs(usd) <= DUST_USD) return null;
  const leaving = usd < 0 || f.direction === "down";
  return {
    headline: leaving ? `MONEY CAME OFF ${it}` : `MONEY WENT ON ${it}`,
    detail: leaving
      ? `${money(usd)} left ${it} today.`
      : `${money(usd)} arrived on ${it} today.`,
    level: Math.abs(usd) >= MATERIAL_USD ? "observation" : "receipt",
    suppress: false,
  };
}

/**
 * Compose the row a transition may honestly print.
 *
 * Every branch reads the structured type; nothing here can echo a stored
 * sentence, so a legacy row is re-said in today's voice or not said at all.
 */
export function composeTransition(f: TransitionFacts): ComposedTransition {
  const type = (f.type ?? "").trim();
  if (!type) return NOTHING;
  const side = f.side === "YES" || f.side === "NO" ? f.side : null;
  const it = side ?? "THIS SIDE";
  const move = num(f.pricePct);

  switch (type) {
    case "majority_flipped": {
      if (!side) return NOTHING;
      return {
        headline: `${side} IS AHEAD NOW`,
        detail: split(f) ?? `${side} took the lead today.`,
        level: split(f) ? "observation" : "receipt",
        suppress: false,
      };
    }
    case "market_balanced": {
      return {
        headline: "THE ROOM IS SPLIT",
        detail: split(f) ?? "Both sides are carrying the same weight.",
        level: split(f) ? "observation" : "receipt",
        suppress: false,
      };
    }
    case "side_doubled": {
      if (!side) return NOTHING;
      const n = num(side === "YES" ? f.believersYes : f.believersNo);
      return {
        headline: `${side} DOUBLED`,
        detail: n != null ? `${people(n)} are on ${side} now.` : `Twice as many are on ${side}.`,
        level: n != null ? "observation" : "receipt",
        suppress: false,
      };
    }
    case "market_dividing": {
      return {
        headline: "THE ROOM IS DIVIDING",
        detail: split(f) ?? "Both sides are gaining at once.",
        level: split(f) ? "observation" : "receipt",
        suppress: false,
      };
    }
    case "people_capital_divergence": {
      const usd = num(f.capitalDeltaUsd);
      if (usd == null || Math.abs(usd) <= DUST_USD) return NOTHING;
      return {
        headline: "PEOPLE AND MONEY DISAGREE",
        detail: `${split(f) ?? `More are backing ${it}.`} ${money(usd)} ${usd < 0 ? "left" : "arrived"} today.`.trim(),
        level: "observation",
        suppress: false,
      };
    }
    case "concentration_rising": {
      return {
        headline: "FEWER HANDS HOLD MORE",
        detail: `The money behind ${it} is sitting in fewer positions.`,
        level: "receipt",
        suppress: false,
      };
    }
    case "price_conviction_divergence": {
      if (move == null) return NOTHING;
      return {
        headline: "THE PRICE MOVED. THEY DIDN'T.",
        detail: `${side ?? "The price"} ${move < 0 ? "fell" : "rose"} ${pct(move)} and the positions behind it are unchanged.`,
        level: "observation",
        suppress: false,
      };
    }
    case "accelerating": {
      return {
        headline: `${it} IS SPEEDING UP`,
        detail: `Trades on ${it} are arriving faster than this market's normal.`,
        level: "receipt",
        suppress: false,
      };
    }
    case "participation_broadening": {
      return {
        headline: "MORE PEOPLE, SMALLER TICKETS",
        detail: split(f) ?? `More names are on ${it}, each for less.`,
        level: split(f) ? "observation" : "receipt",
        suppress: false,
      };
    }
    case "material_move": {
      if (f.metric === "price") {
        if (move == null) return NOTHING;
        return {
          headline: `${it} ${move < 0 ? "FELL" : "ROSE"} ${pct(move)}`,
          detail: `A ${pct(move)} move on ${it} in a day.`,
          level: "observation",
          suppress: false,
        };
      }
      if (f.metric === "believers") {
        const s = split(f);
        if (!s) return NOTHING;
        return {
          headline: `THE CROWD ON ${it} CHANGED`,
          detail: s,
          level: "observation",
          suppress: false,
        };
      }
      return capitalLine(f, it) ?? NOTHING;
    }
    case "capital_milestone": {
      /* Proof of life, said plainly — a milestone is not a clue. */
      const usd = num(f.capitalDeltaUsd);
      if (usd == null || Math.abs(usd) <= DUST_USD) return NOTHING;
      return {
        headline: `MONEY ON ${it}`,
        detail: `${money(usd)} went on ${it} today.`,
        level: "receipt",
        suppress: false,
      };
    }
    case "market_reawakened": {
      return {
        headline: "IT WOKE UP",
        detail: "This market had gone quiet for a week. It's trading again.",
        level: "observation",
        suppress: false,
      };
    }
    case "tribe_forming": {
      if (!side) return NOTHING;
      return {
        headline: `A GROUP IS FORMING ON ${side}`,
        detail: split(f) ?? `People who think alike are landing on ${side}.`,
        level: "observation",
        suppress: false,
      };
    }
    case "losing_conviction": {
      const line = capitalLine(f, it);
      if (line) return { ...line, headline: `${it} IS THINNING` };
      const n = num(side === "YES" ? f.believersYes : f.believersNo);
      if (n == null) return NOTHING;
      return {
        headline: `${it} IS THINNING`,
        detail: `${people(n)} left on ${it}.`,
        level: "receipt",
        suppress: false,
      };
    }
    case "believer_milestone": {
      const n = num(side === "YES" ? f.believersYes : f.believersNo);
      if (n == null) return NOTHING;
      return {
        headline: `${it} PASSED ${n}`,
        detail: `${people(n)} are on ${it}.`,
        level: "receipt",
        suppress: false,
      };
    }
    default:
      // An unknown type has no structured meaning here. Silence beats echoing
      // whatever sentence happens to be frozen in the row.
      return NOTHING;
  }
}

/**
 * The one string this module exists to make impossible. Exported so the
 * contract check can assert no composed transition can ever produce it.
 */
export const BANNED_LEGACY_PROSE = ["getting lighter", "some of what was behind it walked"];
