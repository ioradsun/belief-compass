/**
 * ORDER ACTIONS — ownership is CONTEXT, never the controls.
 *
 * The deck used to infer the intended trade from what you already held: it
 * collapsed your position to a single side (YES won if you held both), then
 * offered "Sell / Buy more YES". Three things broke:
 *   • Holding BOTH sides made the second holding invisible and unsellable.
 *   • There was no way to buy the OPPOSITE side of what you owned.
 *   • There was no way to pass and move on to the next market.
 *
 * So the system stops guessing. Ownership is shown as context above one stable
 * selector — Buy · Sell · Pass — and the side is chosen explicitly in a second
 * step, in the SAME three-button footprint:
 *
 *     Buy  → Back NO · Back YES · Cancel
 *     Sell → (one side owned) straight to that side
 *            (both owned)     Sell NO · Sell YES · Cancel
 *
 * Intent becomes explicit, the layout never changes shape, and every state is
 * reachable regardless of what you hold.
 *
 * ZERO IO, pure, fully testable.
 */

export type Side = "YES" | "NO";

export interface OwnedSide {
  side: Side;
  /** Raw token balance — the only trustworthy proof of ownership. */
  tokens: bigint;
  /** Marked value in USD, when the read model knows it. Display only. */
  worthUsd: number | null;
}

export interface Owned {
  yes: OwnedSide | null;
  no: OwnedSide | null;
  /** Holds at least one side. */
  any: boolean;
  /** Holds BOTH sides — the case the old single-`held` model erased. */
  both: boolean;
  /** The one side held, when exactly one is — lets Sell skip a needless step. */
  only: Side | null;
}

/**
 * Build the honest ownership picture from token balances. Worth is decoration:
 * a side counts as owned when it has TOKENS, never because a price exists.
 */
export function ownedPositions(input: {
  yesTokens: bigint | null | undefined;
  noTokens: bigint | null | undefined;
  yesWorthUsd?: number | null;
  noWorthUsd?: number | null;
}): Owned {
  const yesTokens = input.yesTokens ?? 0n;
  const noTokens = input.noTokens ?? 0n;
  const yes: OwnedSide | null =
    yesTokens > 0n ? { side: "YES", tokens: yesTokens, worthUsd: input.yesWorthUsd ?? null } : null;
  const no: OwnedSide | null =
    noTokens > 0n ? { side: "NO", tokens: noTokens, worthUsd: input.noWorthUsd ?? null } : null;

  const both = !!yes && !!no;
  return {
    yes,
    no,
    any: !!yes || !!no,
    both,
    only: both ? null : yes ? "YES" : no ? "NO" : null,
  };
}

/**
 * What tapping SELL should do. One owned side needs no side-picker — going
 * straight to it removes a pointless tap; two needs an explicit choice.
 */
export type SellStep = { kind: "none" } | { kind: "direct"; side: Side } | { kind: "choose" };

export function sellStep(owned: Owned): SellStep {
  if (owned.both) return { kind: "choose" };
  if (owned.only) return { kind: "direct", side: owned.only };
  return { kind: "none" };
}

/** Look up one side's holding. */
export function heldSide(owned: Owned, side: Side): OwnedSide | null {
  return side === "YES" ? owned.yes : owned.no;
}
