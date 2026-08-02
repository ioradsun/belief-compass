/**
 * On-chain attribution tag — how anyone, POV included, can verify Conviction's
 * contribution to the ecosystem without trusting our database.
 *
 * WHY A SUFFIX. The contract has a native referral system (addReferral /
 * referrerOf / ReferralFeePaid), but addReferral is owner-gated — a non-owner call
 * reverts with "Ownable: caller is not the owner" — so we cannot register referrals
 * ourselves. And buy()/sell() take no referrer parameter. The one place left to put
 * a marker, without touching the contract, is the calldata itself.
 *
 * WHY IT IS SAFE. Solidity's dispatcher decodes arguments at fixed offsets and
 * ignores trailing calldata; it never requires calldatasize to match exactly. This
 * was verified against the live contract on Base rather than assumed — identical
 * return values with and without the suffix, for both the static tuple buy() uses
 * (uint256, bool, uint256) and a dynamic string argument like createMarket's. The
 * create path additionally simulates before sending, so a bad suffix could never
 * move money.
 *
 * WHAT IT COSTS. 18 non-zero calldata bytes, ~288 gas — immaterial on Base. It adds
 * no transaction, no signature and no approval step.
 *
 * HOW TO VERIFY. Every transaction Conviction routes ends with these bytes. Filter
 * the contract's transactions by `tx.input.endsWith(CONVICTION_TAG.slice(2))` and
 * you have reproduced our numbers from public chain data alone. The tag is plain
 * ASCII so it is legible in any block explorer's UTF-8 view.
 */

/** The tag as text, for docs and explorer cross-checking. */
export const CONVICTION_TAG_TEXT = "conviction.company";

/** ASCII "conviction.company" (18 bytes) — appended to every transaction we send. */
export const CONVICTION_TAG = "0x636f6e76696374696f6e2e636f6d70616e79" as const;

/** True when a transaction's calldata carries our attribution tag. */
export function hasConvictionTag(input: string | null | undefined): boolean {
  if (!input) return false;
  return input.toLowerCase().endsWith(CONVICTION_TAG.slice(2));
}
