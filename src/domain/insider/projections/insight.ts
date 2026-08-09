/**
 * PROJECTION — INSIDER INSIGHT: "what does everything here MEAN?"
 *
 * The human explanation of the pulse — one headline and one calm supporting
 * sentence. The SAME values that produce this sentence are the values that cause
 * a Now story to appear, which is the cohesion the whole design is for.
 *
 * Voice matches the existing pulse narrator (src/domain/market-pulse): calm,
 * observant, never hype. Deterministic and pure — the numbers are the authority,
 * the words only describe them.
 */
import type { InsiderInsight, InsiderPulse } from "../types";

const capitalize = (s: string) => (s.length === 0 ? s : s[0].toUpperCase() + s.slice(1));

function headlineFor(p: InsiderPulse): string {
  if (p.direction === "BALANCED") {
    return p.momentum < 0.2 ? "Holding steady." : "Both sides are live.";
  }
  if (p.momentum >= 0.6) return `${p.direction} is gaining momentum.`;
  if (p.momentum >= 0.3) return `${p.direction} is edging ahead.`;
  return `${p.direction} leads, quietly.`;
}

export function insight(pulse: InsiderPulse): InsiderInsight {
  const dir = pulse.direction;

  // Strongest observations first; a calm sentence names at most two.
  const clauses: string[] = [];
  if (pulse.activity >= 0.5) clauses.push("activity is well above this market's normal pace");
  else if (pulse.activity >= 0.25) clauses.push("activity is picking up");
  if (pulse.capitalFlow >= 0.25) {
    clauses.push(dir === "BALANCED" ? "capital is moving on both sides" : `capital is flowing to ${dir}`);
  }
  if (pulse.participation >= 0.15) clauses.push("new believers are arriving");
  if (pulse.acceleration >= 0.5) clauses.push("the move is speeding up");

  const picked = clauses.slice(0, 2);
  const detail =
    picked.length === 0 ? "Little is moving right now." : `${capitalize(picked.join(" while "))}.`;

  return { headline: headlineFor(pulse), detail, direction: dir, pulse };
}
