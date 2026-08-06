/**
 * Conviction's share of the combined POV + Conviction ecosystem — pure math.
 *
 * The RPC hands back daily buckets plus a baseline (everything before the window).
 * This folds them into cumulative curves so the page can draw the whole market and
 * our slice of it on one axis, and divides the two into the share percentage that
 * is the point of the page.
 *
 * Money arrives as wei strings — numeric sums exceed JS safe-integer range, so they
 * are parsed here and scaled once.
 */

import { weiToEth } from "@/domain/money";

export interface ShareTotals {
  ecoBuyWei: string;
  convBuyWei: string;
  ecoMarkets: number;
  convMarkets: number;
}
export interface ShareDay {
  day: string;
  ecoBuyWei: string;
  convBuyWei: string;
  ecoMarkets: number;
  convMarkets: number;
}
export interface ShareRpc {
  totals: ShareTotals;
  baseline: ShareTotals;
  byDay: ShareDay[];
}

/** One day on the share curve — cumulative, ecosystem-wide vs Conviction's slice. */
export interface SharePoint {
  day: string;
  ecoVolumeUsd: number;
  convVolumeUsd: number;
  ecoMarkets: number;
  convMarkets: number;
}

/** Conviction's contribution to the combined (pov + conviction) ecosystem. */
export interface EcosystemShare {
  volume: { ecoUsd: number; convUsd: number; pct: number };
  markets: { eco: number; conv: number; pct: number };
  series: SharePoint[];
  days: number;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Share as a percentage; an empty ecosystem is 0, never NaN or Infinity. */
export function sharePct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

export function buildShare(
  raw: ShareRpc | null,
  ethUsd: number,
  nowMs: number,
  days: number,
): EcosystemShare | null {
  if (!raw) return null;

  const ecoUsd = weiToEth(raw.totals.ecoBuyWei) * ethUsd;
  const convUsd = weiToEth(raw.totals.convBuyWei) * ethUsd;

  // Start each running total at everything that happened before the window, so the
  // curve shows true cumulative position rather than restarting at zero.
  let cEco = weiToEth(raw.baseline.ecoBuyWei) * ethUsd;
  let cConv = weiToEth(raw.baseline.convBuyWei) * ethUsd;
  let cEcoM = num(raw.baseline.ecoMarkets);
  let cConvM = num(raw.baseline.convMarkets);

  const byDay = new Map(raw.byDay.map((d) => [d.day, d]));
  const series: SharePoint[] = [];
  for (let i = days; i >= 0; i--) {
    const dt = new Date(nowMs - i * 86_400_000);
    dt.setUTCHours(0, 0, 0, 0);
    const day = dt.toISOString().slice(0, 10);
    const d = byDay.get(day);
    if (d) {
      cEco += weiToEth(d.ecoBuyWei) * ethUsd;
      cConv += weiToEth(d.convBuyWei) * ethUsd;
      cEcoM += num(d.ecoMarkets);
      cConvM += num(d.convMarkets);
    }
    series.push({ day, ecoVolumeUsd: cEco, convVolumeUsd: cConv, ecoMarkets: cEcoM, convMarkets: cConvM });
  }

  return {
    volume: { ecoUsd, convUsd, pct: sharePct(convUsd, ecoUsd) },
    markets: {
      eco: num(raw.totals.ecoMarkets),
      conv: num(raw.totals.convMarkets),
      pct: sharePct(num(raw.totals.convMarkets), num(raw.totals.ecoMarkets)),
    },
    series,
    days,
  };
}
