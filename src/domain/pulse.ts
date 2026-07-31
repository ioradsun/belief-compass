/**
 * PULSE — two separate questions, never collapsed into one.
 *
 *   1. What does the market look like NOW?      → market state
 *   2. What changed in the selected window?     → recent activity
 *
 * Every label maps to an explicit numeric rule, so the sentence can never
 * contradict the numbers rendered next to it (no "People divided" above a 35–1
 * market). Side names are deliberately absent: the shape of conviction is
 * neutral information, the direction of it is Case File evidence.
 *
 * ZERO IO, pure, fully testable.
 */
import type { TapeTrade } from "./conviction-series";
import { FLOW_WINDOW_MS, FLOW_WINDOW_SHORT, type FlowWindow } from "./market-flow";

export interface PulseInput {
  yesBelievers: number;
  noBelievers: number;
  /** Capital still committed on each side, in USD. */
  yesCapital: number;
  noCapital: number;
  periodNewBelievers: number;
  periodExitedBelievers: number;
  periodNetCapital: number;
  /** Price move across the window, in %. Null when unknown. */
  periodPriceChange: number | null;
  selectedPeriod: FlowWindow;
}

export interface Pulse {
  /** "1D" — shown in the eyebrow next to the word Pulse. */
  periodShort: string;
  stateLabel: string;
  stateExplanation: string;
  activityLabel: string;
  activityExplanation: string;
  /** "+1 believer · +$3 committed · Price −1.5%" — empty when nothing changed. */
  activityMetrics: string;
}

/** Below this many believers, exact counts are more honest than percentages. */
export const COUNTS_BELOW = 50;
/** Money smaller than this is noise, not a story. */
const USD_EPS = 1;

const PERIOD_PHRASE: Record<FlowWindow, string> = {
  "1h": "the past hour",
  "24h": "the past day",
  "7d": "the past week",
  "30d": "the past month",
  all: "this market's history",
};

const usd = (n: number): string => {
  const a = Math.abs(n);
  const s =
    a >= 10_000
      ? `$${Math.round(a / 1000)}k`
      : a >= 1000
        ? `$${(a / 1000).toFixed(1)}k`
        : `$${Math.round(a)}`;
  return s;
};

const people = (n: number): string => `${n} believer${n === 1 ? "" : "s"}`;

// ---------------------------------------------------------------------------
// Tape → the structured numbers the copy is generated from
// ---------------------------------------------------------------------------

type Book = Record<"YES" | "NO", number>;
const sideOf = (b: Book): "YES" | "NO" | null => {
  const yes = b.YES > 1e-12;
  const no = b.NO > 1e-12;
  if (yes && !no) return "YES";
  if (no && !yes) return "NO";
  return null;
};

/**
 * Replays the canonical tape into the current per-side standings plus the
 * window's change. A believer is a wallet that currently holds a position on
 * exactly one side; a wallet holding both is mixed and belongs to neither.
 */
export function pulseInputFromTape(
  tape: TapeTrade[],
  win: FlowWindow,
  nowMs: number,
  ethUsd: number,
  priceChangePct: number | null = null,
): PulseInput {
  const sorted = tape.filter((t) => Number.isFinite(t.t)).sort((a, b) => a.t - b.t);
  const since = win === "all" ? -Infinity : nowMs - FLOW_WINDOW_MS[win];
  const rate = ethUsd > 0 ? ethUsd : 0;

  const books = new Map<string, Book>();
  const capital: Book = { YES: 0, NO: 0 };
  let entered = 0;
  let exited = 0;
  let netEth = 0;

  for (const t of sorted) {
    const eth = Number.isFinite(t.eth) ? Math.max(0, t.eth) : 0;
    const book = books.get(t.w) ?? { YES: 0, NO: 0 };
    const before = book[t.side];
    const wasDirectional = sideOf(book) != null;
    book[t.side] = t.action === "BUY" ? before + eth : Math.max(0, before - eth);
    books.set(t.w, book);

    const moved = book[t.side] - before;
    capital[t.side] = Math.max(0, capital[t.side] + moved);
    const isDirectional = sideOf(book) != null;
    if (t.t >= since) {
      netEth += moved;
      if (isDirectional && !wasDirectional) entered += 1;
      if (!isDirectional && wasDirectional) exited += 1;
    }
  }

  let yesBelievers = 0;
  let noBelievers = 0;
  for (const b of books.values()) {
    const s = sideOf(b);
    if (s === "YES") yesBelievers += 1;
    else if (s === "NO") noBelievers += 1;
  }

  return {
    yesBelievers,
    noBelievers,
    yesCapital: capital.YES * rate,
    noCapital: capital.NO * rate,
    periodNewBelievers: entered,
    periodExitedBelievers: exited,
    periodNetCapital: netEth * rate,
    periodPriceChange: priceChangePct,
    selectedPeriod: win,
  };
}

// ---------------------------------------------------------------------------
// Market state — the current shape of conviction
// ---------------------------------------------------------------------------

export interface StateCopy {
  label: string;
  explanation: string;
}

/** How the committed money sits relative to the believer majority. */
function capitalModifier(input: PulseInput, believerSide: "YES" | "NO" | null): string {
  const total = input.yesCapital + input.noCapital;
  if (total < USD_EPS || believerSide == null) return "";
  const capitalSide = input.yesCapital >= input.noCapital ? "YES" : "NO";
  const capitalShare = Math.max(input.yesCapital, input.noCapital) / total;

  if (capitalSide === believerSide) {
    if (capitalShare >= 0.9) return ", with nearly all capital there too";
    if (capitalShare >= 0.65) return ", and most capital is there too";
    if (capitalShare < 0.55) return ", but committed capital remains more balanced";
    return "";
  }
  if (capitalShare >= 0.65) return ", while the smaller group holds most of the capital";
  if (capitalShare >= 0.55) return ", while the smaller group holds more of the capital";
  return "";
}

/** Deterministic label from the believer split. Never classifies an empty market. */
export function marketState(input: PulseInput): StateCopy {
  const y = Math.max(0, input.yesBelievers);
  const n = Math.max(0, input.noBelievers);
  const total = y + n;
  if (total === 0)
    return {
      label: "No conviction yet",
      explanation: "No directional believers have entered this market yet.",
    };
  if (total === 1)
    return {
      label: "First conviction",
      explanation: "One believer has taken the first position.",
    };

  const top = Math.max(y, n);
  const side: "YES" | "NO" = y >= n ? "YES" : "NO";
  const shareShare = top / total;
  const mod = capitalModifier(input, side);

  // Two believers: state the facts, classify nothing.
  if (total === 2) {
    return top === 1
      ? {
          label: "Early split",
          explanation: "Two believers have entered, one on each side.",
        }
      : {
          label: "Early lean",
          explanation: `Both current believers back the same side${mod}.`,
        };
  }

  const who =
    total < COUNTS_BELOW
      ? `${top} of ${total} current believers back the same side`
      : `${Math.round(shareShare * 100)}% of current believers back the same side`;

  const label =
    shareShare >= 0.97
      ? "Overwhelming consensus"
      : shareShare >= 0.9
        ? "Near consensus"
        : shareShare >= 0.75
          ? "Strong majority"
          : shareShare >= 0.65
            ? "Clear lead"
            : shareShare >= 0.55
              ? "Slight lean"
              : "Evenly split";

  if (label === "Evenly split") {
    const balanced =
      total < COUNTS_BELOW
        ? `Believers are almost evenly divided — ${top} of ${total} on the larger side`
        : "Believers are almost evenly divided between the two sides";
    // "Balanced" may only describe believers; capital gets its own clause.
    const totalCapital = input.yesCapital + input.noCapital;
    const capitalShare =
      totalCapital >= USD_EPS ? Math.max(input.yesCapital, input.noCapital) / totalCapital : 0;
    const tail = capitalShare >= 0.75 ? ", but most capital is concentrated on one side" : "";
    return { label, explanation: `${balanced}${tail}.` };
  }

  return { label, explanation: `${who}${mod}.` };
}

// ---------------------------------------------------------------------------
// Recent activity — only what changed inside the window
// ---------------------------------------------------------------------------

export function recentActivity(input: PulseInput): StateCopy {
  const when = PERIOD_PHRASE[input.selectedPeriod];
  const joined = Math.max(0, input.periodNewBelievers);
  const left = Math.max(0, input.periodExitedBelievers);
  const net = joined - left;
  const money = input.periodNetCapital;
  const moneyUp = money >= USD_EPS;
  const moneyDown = money <= -USD_EPS;

  if (net === 0 && joined === 0 && left === 0 && !moneyUp && !moneyDown)
    return {
      label: "Quiet period",
      explanation: `No meaningful change in believers or capital during ${when}.`,
    };

  if (net > 0 && moneyUp)
    return {
      label: "Conviction grew",
      explanation: `${net} more ${net === 1 ? "believer" : "believers"} entered and ${usd(money)} was committed during ${when}.`,
    };
  if (net > 0 && moneyDown)
    return {
      label: "Interest grew, commitment fell",
      explanation: `${net} more ${net === 1 ? "believer" : "believers"} entered, but ${usd(money)} left during ${when}.`,
    };
  if (net > 0)
    return {
      label: "Participation grew",
      explanation: `${net} new ${net === 1 ? "believer" : "believers"} entered during ${when}.`,
    };
  if (net < 0 && moneyUp)
    return {
      label: "Fewer believers, more capital",
      explanation: `${-net} ${-net === 1 ? "believer" : "believers"} exited while ${usd(money)} was added during ${when}.`,
    };
  if (net < 0)
    return {
      label: "Participation narrowed",
      explanation: `${-net} ${-net === 1 ? "believer" : "believers"} exited during ${when}.`,
    };
  if (moneyUp)
    return {
      label: joined > 0 ? "Capital increased" : "Existing believers added",
      explanation:
        joined > 0
          ? `${usd(money)} was added during ${when}.`
          : `The number of believers held steady while ${usd(money)} was added during ${when}.`,
    };
  if (moneyDown)
    return {
      label: "Capital pulled back",
      explanation: `${usd(money)} was withdrawn during ${when}.`,
    };
  return {
    label: "Positions rotated",
    explanation: `Believers changed hands during ${when}, with committed capital roughly unchanged.`,
  };
}

/** The single restrained metrics row under the state sentence. */
export function activityMetrics(input: PulseInput): string {
  const parts: string[] = [];
  const net = Math.max(0, input.periodNewBelievers) - Math.max(0, input.periodExitedBelievers);
  if (net !== 0) parts.push(`${net > 0 ? "+" : "−"}${people(Math.abs(net))}`);
  if (Math.abs(input.periodNetCapital) >= USD_EPS)
    parts.push(`${input.periodNetCapital > 0 ? "+" : "−"}${usd(input.periodNetCapital)} committed`);
  const p = input.periodPriceChange;
  if (p != null && Number.isFinite(p) && Math.abs(p) >= 0.05)
    parts.push(`Price ${p < 0 ? "−" : "+"}${Math.abs(p).toFixed(Math.abs(p) < 10 ? 1 : 0)}%`);
  return parts.join(" · ");
}

export function composePulse(input: PulseInput): Pulse {
  const state = marketState(input);
  const activity = recentActivity(input);
  return {
    periodShort: FLOW_WINDOW_SHORT[input.selectedPeriod],
    stateLabel: state.label,
    stateExplanation: state.explanation,
    activityLabel: activity.label,
    activityExplanation: activity.explanation,
    activityMetrics: activityMetrics(input),
  };
}
