/**
 * CAN THIS TRADE ACTUALLY BE PAID FOR — one rule, and it fails closed.
 *
 * WHAT THIS REPLACES. The order ticket compared the trade amount to the wallet's
 * full balance:
 *
 *     overBalance = availEth != null && ethUsd > 0 && amount > availEth * ethUsd
 *
 * Three holes, in ascending order of how badly they end:
 *
 *   1. NO GAS HEADROOM. A wallet holding exactly the trade amount passes, then
 *      has nothing left for the transaction fee. The user signs, and the
 *      transaction reverts or the wallet rejects it — the exact "never ask
 *      someone to sign something guaranteed to fail" case. The comparison has to
 *      be against amount PLUS the fee, not the amount.
 *
 *   2. THE COPY NAMES NOTHING. "Insufficient balance" tells a person neither how
 *      short they are nor what to do. Two numbers turn a dead end into an
 *      errand.
 *
 *   3. IT DISABLES ITSELF WHEN THE PRICE IS UNKNOWN. `ethUsd > 0` is a
 *      precondition of the whole guard, so when the ETH/USD rate is missing the
 *      check does not fail — it stops existing, and any amount passes. That
 *      rate comes from `calc_cache`, which this repo has already watched return
 *      zero rows silently under RLS (see check-feed-supply). So the one
 *      condition under which we cannot price the trade is the condition under
 *      which we stopped checking it.
 *
 * A SAFETY CHECK THAT SWITCHES OFF WHEN ITS INPUT IS MISSING IS NOT A SAFETY
 * CHECK. This one returns `unknown` instead, which the interface must treat as
 * blocking — the user is told we cannot price it rather than waved through.
 *
 * ZERO IO, pure, fully testable.
 */

/**
 * ETH held back for the transaction fee.
 *
 * Base is cheap — a trade is fractions of a cent — but "cheap" is not "free",
 * and the failure this prevents costs a signature and a revert. Ten-thousandths
 * of an ETH is orders of magnitude above a Base fee while being small enough
 * that it never blocks a real trade: at $3,000/ETH it reserves about 30 cents.
 *
 * Deliberately a FIXED reserve rather than a live gas estimate. An estimate is
 * another network call on the critical path, another thing that can be missing,
 * and another place for the check to switch itself off — see hole 3.
 */
export const GAS_RESERVE_ETH = 0.0001;

export type Affordability =
  /** Enough for the trade and the fee. */
  | { ok: true }
  /** Not enough. `shortfallEth` is what they would need to add. */
  | { ok: false; reason: "short"; neededEth: number; haveEth: number; shortfallEth: number }
  /** Enough for the trade but not the fee — a distinct and confusing failure. */
  | { ok: false; reason: "gas"; neededEth: number; haveEth: number; shortfallEth: number }
  /** We could not price this. Blocks, and says so. */
  | { ok: false; reason: "unknown" };

export interface AffordabilityInput {
  /** What the reader is spending, in USD. */
  amountUsd: number;
  /** Wallet balance in ETH. Null while loading, or when the read failed. */
  balanceEth: number | null;
  /** ETH/USD. Zero or null means we cannot convert — see hole 3. */
  ethUsd: number | null;
}

export function affordability(input: AffordabilityInput): Affordability {
  const { amountUsd, balanceEth, ethUsd } = input;
  if (!Number.isFinite(amountUsd) || amountUsd <= 0) return { ok: true };
  // Cannot price it, or do not know the balance yet: BLOCK. Not "allow because
  // we are unsure" — that is the hole this module exists to close.
  if (balanceEth == null || !Number.isFinite(balanceEth)) return { ok: false, reason: "unknown" };
  if (ethUsd == null || !Number.isFinite(ethUsd) || ethUsd <= 0)
    return { ok: false, reason: "unknown" };

  const wantEth = amountUsd / ethUsd;
  const neededEth = wantEth + GAS_RESERVE_ETH;
  // A hair of tolerance so a reader who typed their exact balance is not blocked
  // by float noise in the USD round-trip.
  if (balanceEth + 1e-12 >= neededEth) return { ok: true };

  const shortfallEth = neededEth - balanceEth;
  // "You have enough for the trade but not the fee" is a genuinely different
  // situation from "you do not have enough", and a reader who is told the first
  // one knows to keep a little back next time.
  return {
    ok: false,
    reason: balanceEth + 1e-12 >= wantEth ? "gas" : "short",
    neededEth,
    haveEth: balanceEth,
    shortfallEth,
  };
}

/** ETH at a readable precision. Six places: a Base fee is visible, noise is not. */
const eth = (v: number): string => {
  const s = Math.max(0, v).toFixed(6);
  return s.includes(".") ? s.replace(/0+$/, "").replace(/\.$/, "") : s;
};

/**
 * What the button says, and what sits under it.
 *
 * The label stays short enough for a button; the detail carries the two numbers,
 * because "you need X and have Y" is the difference between a dead end and an
 * errand the reader can complete.
 */
export function affordabilityCopy(a: Affordability): { label: string; detail: string } | null {
  if (a.ok) return null;
  if (a.reason === "unknown") {
    return {
      label: "Can't price this right now",
      // Never imply the wallet is the problem when the problem is ours.
      detail: "We can't check your balance against this amount yet. Try again in a moment.",
    };
  }
  if (a.reason === "gas") {
    return {
      label: "Not enough for the network fee",
      detail: `This trade needs ${eth(a.neededEth)} ETH including the network fee. You have ${eth(a.haveEth)} ETH — ${eth(a.shortfallEth)} short.`,
    };
  }
  return {
    label: "Not enough ETH",
    detail: `You need ${eth(a.neededEth)} ETH for this trade and the network fee. You have ${eth(a.haveEth)} ETH — ${eth(a.shortfallEth)} short.`,
  };
}
