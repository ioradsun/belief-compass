/**
 * LIVE NOW — the single most recent thing that happened in this market.
 *
 * The center shows exactly ONE chronological line ("2 believers joined YES ·
 * 3m ago"). Unlike the Case File, this reports HISTORY, so it may name a side —
 * it is a fact about what occurred, not evidence for a position. It reuses the
 * per-side event rail and simply returns the newest beat across both sides.
 *
 * ZERO IO, pure, fully testable.
 */
import { timelineEvents, type TapeTrade, type TimelineEvent } from "./conviction-series";

/** The newest event across both sides, or null on a market with no activity. */
export function latestMarketEvent(tape: TapeTrade[], nowMs: number): TimelineEvent | null {
  if (!tape.length) return null;
  const all = [
    ...timelineEvents(tape, "YES", "all", nowMs, 10),
    ...timelineEvents(tape, "NO", "all", nowMs, 10),
  ];
  if (!all.length) return null;
  return all.sort((a, b) => b.t - a.t)[0];
}

/**
 * The newest MATERIAL event: people joining, a whale, or a milestone always
 * count; capital in/out must clear a threshold (a fraction of Market Capital) so
 * dust never fills the line. Null when nothing meaningful happened.
 */
export function latestMaterialEvent(
  tape: TapeTrade[],
  nowMs: number,
  minCapitalEth: number,
): TimelineEvent | null {
  if (!tape.length) return null;
  const all = [
    ...timelineEvents(tape, "YES", "all", nowMs, 12),
    ...timelineEvents(tape, "NO", "all", nowMs, 12),
  ].sort((a, b) => b.t - a.t);
  for (const e of all) {
    if (e.kind === "capital" || e.kind === "exit") {
      if ((e.eth ?? 0) >= minCapitalEth) return e;
      continue;
    }
    return e; // believers, whale, milestone — always material
  }
  return null;
}

/** The side a rail event refers to — encoded in its id (`bel-YES-…`). */
export function eventSide(e: TimelineEvent): "YES" | "NO" | null {
  const part = e.id.split("-")[1];
  return part === "YES" || part === "NO" ? part : null;
}

export interface LiveNowLine {
  emoji: string;
  text: string;
  at: number;
}

/**
 * A ready-to-read Live Now line. `money` formats an ETH amount to the app's USD
 * string, so the domain stays unit-pure. Capital events read "$42 entered NO";
 * everything else keeps the rail's own wording.
 */
export function liveNowLine(e: TimelineEvent, money: (eth: number) => string): LiveNowLine {
  const side = eventSide(e);
  if ((e.kind === "capital" || e.kind === "exit") && e.eth != null && side) {
    const verb = e.kind === "exit" ? "left" : "entered";
    return { emoji: e.emoji, text: `${money(e.eth)} ${verb} ${side}`, at: e.t };
  }
  return { emoji: e.emoji, text: e.text, at: e.t };
}
