/**
 * Welcome — pure selection & aggregation, no IO.
 *
 * "Conviction needs company." When people join a side you already hold, you can
 * welcome them in one tap. This module is the pure core of both directions:
 *
 *  - selectWelcomable: from the recent new-believers on markets you hold, keep
 *    only those on YOUR side, that aren't you, and that you haven't welcomed yet.
 *  - summarizeReceived: fold the welcomes you received into one aggregated line
 *    (never twelve notifications — one "N believers welcomed you").
 *
 * All matching is lower-cased and deduped so a wallet is offered / counted once
 * per tribe (market + side).
 */

export type Side = "YES" | "NO";

export interface DirectionalEvent {
  wallet: string;
  marketId: number;
  newSide: Side;
  /** Canonical occurrence — events must arrive newest-first for dedup to keep the latest. */
  occurredAt: string;
}

export interface Welcomable {
  wallet: string;
  marketId: number;
  side: Side;
}

export interface ReceivedWelcome {
  welcomer: string;
  marketId: number;
  side: Side;
}

/** Stable identity of one welcome (recipient in a given tribe). */
export function welcomeKey(recipient: string, marketId: number, side: Side): string {
  return `${recipient.toLowerCase()}:${marketId}:${side}`;
}

/**
 * Who the viewer can welcome: new believers on the exact side the viewer holds,
 * excluding the viewer and anyone already welcomed. `events` should be newest
 * first; the first occurrence of each (wallet, market, side) wins.
 */
export function selectWelcomable(params: {
  viewer: string;
  positions: Map<number, Side>;
  events: DirectionalEvent[];
  alreadyWelcomed: Set<string>;
  cap?: number;
}): Welcomable[] {
  const { viewer, positions, events, alreadyWelcomed, cap = 30 } = params;
  const v = viewer.toLowerCase();
  const seen = new Set<string>();
  const out: Welcomable[] = [];
  for (const e of events) {
    const side = positions.get(e.marketId);
    if (!side || side !== e.newSide) continue; // must be on YOUR side
    const w = e.wallet.toLowerCase();
    if (w === v) continue; // never yourself
    const key = welcomeKey(w, e.marketId, side);
    if (alreadyWelcomed.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ wallet: w, marketId: e.marketId, side });
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Fold received welcomes into one aggregated summary: distinct welcomers (each
 * person counts once even if they welcomed you on several markets), and the
 * single tribe when every welcome is for the same side of the same market.
 */
export function summarizeReceived(welcomes: ReceivedWelcome[]): {
  count: number;
  welcomers: string[];
  tribe: { marketId: number; side: Side } | null;
} {
  const welcomers = [...new Set(welcomes.map((w) => w.welcomer.toLowerCase()))];
  const tribes = new Set(welcomes.map((w) => `${w.marketId}:${w.side}`));
  const tribe =
    tribes.size === 1 && welcomes.length > 0
      ? { marketId: welcomes[0].marketId, side: welcomes[0].side }
      : null;
  return { count: welcomers.length, welcomers, tribe };
}
