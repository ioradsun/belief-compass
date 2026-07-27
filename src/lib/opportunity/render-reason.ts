/**
 * Opportunity reason renderer — turns a reason code + structured evidence into
 * concise factual copy. Pure. The SERVER owns reason copy; the client never
 * invents reasons from raw metrics.
 *
 * Rules: real numbers, disclose the window, no certainty, no motive attribution,
 * no "everyone"/"exploding"/"people like you"/Tribe/Rival language, no unsupported
 * emotional framing. Vocabulary: people, believers, backed, traded, entered, held,
 * circulated, split.
 */
type Evidence = Record<string, unknown>;

const n = (v: unknown): number => Number(v ?? 0);
const windowLabel = (w: unknown): string =>
  w === "1h"
    ? "the last hour"
    : w === "24h"
      ? "the last 24 hours"
      : w === "7d"
        ? "the last 7 days"
        : "so far";
const plural = (x: number, u: string) => `${x} ${u}${x === 1 ? "" : "s"}`;

/** Deterministic factual reason. Falls back to a neutral line if evidence is thin. */
export function renderReason(reasonCode: string | null, ev: Evidence): string {
  const w = windowLabel(ev.window);
  switch (reasonCode) {
    case "HOT_ACCELERATING_BREADTH":
    case "HOT_ACCELERATING_VOLUME":
      return `${plural(n(ev.unique_wallets), "wallet")} traded in ${w}, up from a baseline of ${round(n(ev.baseline_wallets_per_hour), 1)}/hour.`;
    case "EARLY_NEW_BELIEVERS":
      return `${plural(n(ev.new_believers), "new believer")} in ${w}, with ${n(ev.directional_believers)} directional so far.`;
    case "EARLY_BREADTH_WITH_LOW_MATURITY":
      return `${plural(n(ev.unique_wallets), "wallet")} backed in ${w} while participation is still small.`;
    case "HIDDEN_HIGH_CIRCULATION_LOW_CAPITAL":
    case "HIDDEN_BREADTH_BELOW_VISIBILITY":
      return `Circulated ${round(n(ev.circulation), 1)}× in ${w} across ${plural(n(ev.unique_wallets), "wallet")}, on a small book.`;
    case "CONTESTED_BALANCED_ACTIVE_SIDES":
      return `${n(ev.believers_yes)} believers back YES and ${n(ev.believers_no)} back NO, with ${n(ev.trade_count_24h)} trades in the last 24 hours.`;
    case "CONTESTED_PEOPLE_MONEY_DISAGREEMENT":
      return `People and money split: ${round(n(ev.people_yes_pct), 0)}% of believers back YES vs ${round(n(ev.money_yes_pct), 0)}% of the money.`;
    case "CONVICTION_PERSISTENCE_UNDER_CHALLENGE":
    case "CONVICTION_BREADTH_WITH_CIRCULATION":
      return `${n(ev.directional_believers)} believers have held directional for a median of ${round(n(ev.median_directional_days), 0)} days while the market circulated ${round(n(ev.circulation_7d), 1)}× this week.`;
    case "NEW_RECENT_MARKET":
      return `New market — ${round(n(ev.market_age_hours), 0)}h old, still gathering evidence.`;
    default:
      return "";
  }
}

function round(x: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}
