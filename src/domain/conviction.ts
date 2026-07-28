/**
 * Conviction signal — the "diamond hands" read on a market side (pure, no IO).
 *
 * A market side is a battlefield; this picks the ONE truest thing to say about
 * who is standing on it, ranked by FOMO:
 *
 *   1. network   — someone the viewer trusts (twin / tribe) is holding this side
 *   2. diamond   — the strongest conviction holder, by TIME × SIZE (not time
 *                  alone: a week-old dust position isn't conviction)
 *   3. momentum  — nobody's committed yet, but the price is moving this way
 *   4. null      — the side is dead; show nothing (honesty over decoration)
 *
 * The server owns the believers; this is the client-safe ranking it renders.
 */

export type ConvictionKind = "network" | "diamond" | "momentum";

/** One directional holder, as returned by getMarketEvidence. */
export interface ConvictionHolder {
  wallet: string;
  name: string;
  avatarUrl: string | null;
  side: "YES" | "NO";
  shares: number;
  daysHeld: number;
}

export interface ConvictionSignal {
  kind: ConvictionKind;
  /** Short tag for the slot, e.g. "Diamond hands", "Your twin", "Heating up". */
  label: string;
  /** Trailing metric, e.g. "42d", "▲ 8%". Empty when there's nothing to add. */
  detail: string;
  /** The person behind it (network / diamond); null for momentum. */
  wallet: string | null;
  name: string | null;
  avatarUrl: string | null;
  /** Whether to ring the face — this is one of the viewer's own people. */
  yours: boolean;
}

/** Momentum only speaks when the price has moved at least this much (%). */
const MOMENTUM_MIN_PCT = 3;

/**
 * time × size — the honest conviction score. Size counts on its own (a fresh
 * whale is a real signal) and every day held compounds it, so a long-held
 * position beats a fresh one and dust can't win on time alone.
 */
const score = (h: ConvictionHolder) => (Math.max(0, h.daysHeld) + 1) * Math.max(0, h.shares);

/** Days held → a compact detail string ("just in" for a fresh position). */
const heldDetail = (days: number) => (days >= 1 ? `${Math.round(days)}d` : "just in");

/** The champion label: diamond hands once it's genuinely been held a while. */
const DIAMOND_LABEL = "Diamond hands";
const FRESH_LABEL = "Top holder";

/**
 * The single strongest conviction signal for one side, or null if the side has
 * nothing true to show. `network` maps a wallet to the viewer's relationship
 * with it (only "twin"/"tribe" get the aligned treatment); `momentumPct` is the
 * side's windowed price change.
 */
export function convictionSignal(
  holders: ConvictionHolder[],
  side: "YES" | "NO",
  opts: { network?: Map<string, string>; momentumPct?: number | null } = {},
): ConvictionSignal | null {
  const network = opts.network;
  const onSide = holders
    .filter((h) => h.side === side && h.shares > 0)
    .sort((a, b) => score(b) - score(a));

  // 1. Network — the highest-conviction holder who is one of the viewer's people.
  if (network && network.size > 0) {
    const mine = onSide.find((h) => {
      const rel = network.get(h.wallet.toLowerCase());
      return rel === "twin" || rel === "tribe";
    });
    if (mine) {
      const rel = network.get(mine.wallet.toLowerCase());
      return {
        kind: "network",
        label: rel === "twin" ? "Your twin" : "Your tribe",
        detail: heldDetail(mine.daysHeld),
        wallet: mine.wallet,
        name: mine.name,
        avatarUrl: mine.avatarUrl,
        yours: true,
      };
    }
  }

  // 2. Diamond hands — the strongest conviction holder overall (time × size).
  const top = onSide[0];
  if (top && score(top) > 0) {
    const held = top.daysHeld >= 1;
    return {
      kind: "diamond",
      label: held ? DIAMOND_LABEL : FRESH_LABEL,
      detail: heldDetail(top.daysHeld),
      wallet: top.wallet,
      name: top.name,
      avatarUrl: top.avatarUrl,
      yours: false,
    };
  }

  // 3. Momentum — nobody's committed, but the price is moving this way.
  const pct = opts.momentumPct;
  if (pct != null && Number.isFinite(pct) && pct >= MOMENTUM_MIN_PCT) {
    return {
      kind: "momentum",
      label: "Heating up",
      detail: `▲ ${Math.round(pct)}%`,
      wallet: null,
      name: null,
      avatarUrl: null,
      yours: false,
    };
  }

  // 4. Dead side — say nothing.
  return null;
}
