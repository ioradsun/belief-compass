/**
 * Market vitals — turn the raw numbers into a story, not math.
 *
 * A belief isn't a volume/pool ratio; it's a living contest. This maps the four
 * dimensions the app already tracks into four "vital signs" a human reads in
 * seconds:
 *
 *   ❤️  Pulse       — is this market alive? (how much capital keeps changing hands)
 *   👥 Crowd       — how many independent believers?
 *   💰 Conviction  — how much capital is still backing the belief?
 *   ⚔️  Battle      — how split are the two sides?
 *
 * ZERO IO. Pure and fully unit-tested. Honesty is enforced by the thresholds:
 * "alive" only when turnover is genuinely high, "flatline" when almost nothing
 * has changed hands. No manufactured hype, no urgency, no invented numbers — the
 * label can only ever say what the data proves.
 */

// ---------------------------------------------------------------------------
// Pulse — activity / circulation. Turnover = money traded ÷ money still held.
// A market where capital keeps changing hands is alive; one where the pool
// ≈ the volume has barely been tested.
// ---------------------------------------------------------------------------

export type PulseLevel = "alive" | "active" | "quiet" | "flatline";

export const PULSE_THRESHOLDS = {
  alive: 3, // ≥3× turnover — money keeps moving
  active: 1.6, // ≥1.6× — real back-and-forth
  quiet: 1.15, // ≥1.15× — a little has moved
  // below `quiet` → flatline (pool ≈ volume; almost untested)
} as const;

// How turnover maps to the 0..100 health bar. Caps at TURNOVER_FULL = "as alive
// as it meaningfully gets" so the bar is readable, not unbounded.
const TURNOVER_FULL = 5;

export interface Pulse {
  level: PulseLevel;
  emoji: string;
  label: string; // "Strong" / "Flatline" …
  turnover: number | null; // volume ÷ pool, or null when there's no pool yet
  healthPct: number; // 0..100 for a health bar
  line: string; // the one-sentence story — no math for the reader
}

export function pulse(volumeUsd: number, poolUsd: number): Pulse {
  const v = Math.max(0, volumeUsd);
  const p = Math.max(0, poolUsd);

  // No capital is sitting in the market yet — we can't claim a pulse.
  if (p <= 0) {
    return {
      level: "flatline",
      emoji: "💤",
      label: "No pool yet",
      turnover: null,
      healthPct: 0,
      line: "Nothing is backing this belief yet.",
    };
  }

  const turnover = v / p;
  const healthPct = Math.max(
    0,
    Math.min(100, Math.round((Math.log(Math.max(1, turnover)) / Math.log(TURNOVER_FULL)) * 100)),
  );

  if (turnover >= PULSE_THRESHOLDS.alive) {
    return {
      level: "alive",
      emoji: "🔥",
      label: "Strong",
      turnover,
      healthPct,
      line: `This market is alive — money has changed hands ${fmtX(turnover)} more than is currently held.`,
    };
  }
  if (turnover >= PULSE_THRESHOLDS.active) {
    return {
      level: "active",
      emoji: "❤️",
      label: "Active",
      turnover,
      healthPct,
      line: "Money keeps changing hands here.",
    };
  }
  if (turnover >= PULSE_THRESHOLDS.quiet) {
    return {
      level: "quiet",
      emoji: "🫧",
      label: "Quiet",
      turnover,
      healthPct,
      line: "A little has moved, but most capital is sitting still.",
    };
  }
  return {
    level: "flatline",
    emoji: "💔",
    label: "Flatline",
    turnover,
    healthPct,
    line: "This belief hasn't been tested — almost every dollar is still where it started.",
  };
}

// ---------------------------------------------------------------------------
// Battle — how split are the two sides? 50/50 is a real fight; 95/5 is settled.
// Takes the money-weighted YES% (0..100). Intensity is 100 at a dead heat.
// ---------------------------------------------------------------------------

export interface Battle {
  emoji: string;
  label: string;
  splitLabel: string; // "52% / 48%"
  intensity: number; // 0..100, peaks at an even split
}

export function battle(yesPct: number | null | undefined): Battle {
  if (yesPct == null || !Number.isFinite(yesPct)) {
    return { emoji: "⚔️", label: "No contest yet", splitLabel: "—", intensity: 0 };
  }
  const y = Math.max(0, Math.min(100, Math.round(yesPct)));
  const n = 100 - y;
  const gap = Math.abs(y - n); // 0 = dead heat, 100 = one-sided
  const intensity = Math.max(0, 100 - gap);
  const splitLabel = `${y}% / ${n}%`;

  if (gap <= 8) return { emoji: "⚔️", label: "Neck and neck", splitLabel, intensity };
  if (gap <= 30)
    return { emoji: "⚔️", label: y >= n ? "Leaning YES" : "Leaning NO", splitLabel, intensity };
  if (gap <= 60)
    return { emoji: "🛡", label: y >= n ? "YES ahead" : "NO ahead", splitLabel, intensity };
  return { emoji: "🏳", label: y >= n ? "YES dominates" : "NO dominates", splitLabel, intensity };
}

// ---------------------------------------------------------------------------
// Crowd — how many independent believers. Counts, not capital.
// ---------------------------------------------------------------------------

export interface Crowd {
  emoji: string;
  label: string;
  count: number;
}

export function crowd(believers: number): Crowd {
  const c = Math.max(0, Math.round(believers));
  if (c === 0) return { emoji: "👤", label: "No believers yet", count: 0 };
  if (c < 5) return { emoji: "👤", label: "Just forming", count: c };
  if (c < 25) return { emoji: "👥", label: "Small crowd", count: c };
  if (c < 150) return { emoji: "👥", label: "Busy", count: c };
  return { emoji: "🏟", label: "Packed", count: c };
}

// ---------------------------------------------------------------------------
// The four vital signs together — a complete story in one object.
// ---------------------------------------------------------------------------

export interface VitalsInput {
  volumeUsd: number; // total traded
  yesCapitalUsd: number; // capital currently backing YES
  noCapitalUsd: number; // capital currently backing NO
  believers: number; // independent believer count
  yesPct: number | null; // money-weighted YES%, 0..100
}

export interface MarketVitals {
  pulse: Pulse;
  crowd: Crowd;
  conviction: { emoji: string; label: string; capitalUsd: number };
  battle: Battle;
}

export function marketVitals(i: VitalsInput): MarketVitals {
  const pool = Math.max(0, i.yesCapitalUsd) + Math.max(0, i.noCapitalUsd);
  return {
    pulse: pulse(i.volumeUsd, pool),
    crowd: crowd(i.believers),
    conviction: { emoji: "💰", label: "still backing this belief", capitalUsd: pool },
    battle: battle(i.yesPct),
  };
}

// ---------------------------------------------------------------------------
// Badges — at most ONE per market, only when the data clearly earns it. Users
// hunt these; they must never be handed out for a state the data can't prove.
// Optional signals (avg hold, creator share) are only used when supplied.
// ---------------------------------------------------------------------------

export interface BadgeInput extends VitalsInput {
  avgHoldDays?: number | null; // for Diamond Hands — omit if unknown
  creatorCapitalShare?: number | null; // 0..1 of pool from the creator — for Founder's Corner
}

export interface Badge {
  emoji: string;
  label: string;
  note: string;
}

export const DIAMOND_HOLD_DAYS = 30;
export const FOUNDER_SHARE = 0.8;
export const CROWD_FAVORITE_BELIEVERS = 150;

export function marketBadge(i: BadgeInput): Badge | null {
  const pool = Math.max(0, i.yesCapitalUsd) + Math.max(0, i.noCapitalUsd);
  const p = pulse(i.volumeUsd, pool);
  const turnover = p.turnover ?? 0;

  // Founder's Corner: almost all liquidity is still the creator's (provable only
  // when the caller supplies the share).
  if (i.creatorCapitalShare != null && i.creatorCapitalShare >= FOUNDER_SHARE) {
    return { emoji: "🏛", label: "Founder's Corner", note: "Almost all capital came from the creator." };
  }
  // Diamond Hands: high circulation AND long average hold (needs avg hold).
  if (p.level === "alive" && i.avgHoldDays != null && i.avgHoldDays >= DIAMOND_HOLD_DAYS) {
    return { emoji: "🧠", label: "Diamond Hands", note: "Heavy trading, yet holders stay for the long run." };
  }
  // Battlefield: capital constantly changing hands.
  if (p.level === "alive") {
    return { emoji: "🔥", label: "Battlefield", note: "People keep challenging each other's conviction." };
  }
  // Crowd Favorite: a real crowd has gathered.
  if (i.believers >= CROWD_FAVORITE_BELIEVERS) {
    return { emoji: "🟢", label: "Crowd Favorite", note: "A big crowd has taken a side." };
  }
  // Ghost Town: pool ≈ volume; almost nothing has moved.
  if (pool > 0 && turnover > 0 && turnover < PULSE_THRESHOLDS.quiet) {
    return { emoji: "😴", label: "Ghost Town", note: "Almost nobody has challenged this belief." };
  }
  return null;
}

// ---------------------------------------------------------------------------

function fmtX(n: number): string {
  // "3.8×" — one decimal under 10, whole numbers above.
  return n >= 10 ? `${Math.round(n)}×` : `${n.toFixed(1)}×`;
}
