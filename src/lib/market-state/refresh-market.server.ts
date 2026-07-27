/**
 * Market read-model refresher — computes one coherent market_state row from the
 * canonical sources (events + wallet_beliefs + transition events + POV display
 * state). One writer for all market-level facts; no surface recomputes them.
 *
 * Aggregation runs in SQL (market_event_windows / market_position_aggregates /
 * market_transition_windows — aggregation only, no reducer/conviction math). The
 * derived metrics + the factual live line come from the pure read-model module.
 * POV-owned display/price fields are preserved, never recomputed from chain data.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  peopleYesPct,
  peopleNoPct,
  divergencePctPoints,
  circulation,
  sellRate,
  buySellRatio,
  marketAgeDays,
  inactiveForSeconds,
  selectLiveLine,
  believerMilestoneAtOrBelow,
  type LiveLineInput,
} from "@/lib/market-state/read-model";
import { evaluateOpportunity, type OpportunityType } from "@/domain/opportunity";
import { OPP } from "@/domain/opportunity-config";
import { buildOpportunityInput } from "@/lib/opportunity/build-input";
import { renderReason } from "@/lib/opportunity/render-reason";

type SB = SupabaseClient;

export interface RefreshResult {
  market: number;
  ok: boolean;
  version?: number;
  liveLineKind?: string | null;
  opportunityType?: string | null;
  error?: string;
}

const num = (v: unknown): number => Number(v ?? 0);
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

/** Refresh one market's read-model row. `ethUsd` converts ETH volume → USD;
 *  `eligibleMarketCount` sets percentile availability for the opportunity engine. */
export async function refreshMarket(
  sb: SB,
  market: number,
  ethUsd: number,
  eligibleMarketCount = 0,
): Promise<RefreshResult> {
  try {
    const nowIso = new Date().toISOString();
    const now = Date.now();

    const [mkt, ms, ev, pos, tr] = await Promise.all([
      sb.from("markets").select("created_at").eq("onchain_id", market).maybeSingle(),
      sb
        .from("market_state")
        .select(
          "read_model_version, money_yes_pct, yes_capital_usd, no_capital_usd, yes_price_usd, no_price_usd, chg_1h, chg_24h, chg_24h_yes, updated_at, opportunity_type, opportunity_type_since, opportunity_previous_type",
        )
        .eq("onchain_id", market)
        .maybeSingle(),
      sb.rpc("market_event_windows", { p_market: market, p_now: nowIso }),
      sb.rpc("market_position_aggregates", { p_market: market, p_now: nowIso }),
      sb.rpc("market_transition_windows", { p_market: market, p_now: nowIso }),
    ]);

    const e = (ev.data ?? {}) as Record<string, unknown>;
    const p = (pos.data ?? {}) as Record<string, unknown>;
    const t = (tr.data ?? {}) as Record<string, unknown>;
    const state = (ms.data ?? {}) as Record<string, unknown>;

    // Participation
    const believersYes = num(p.believers_yes);
    const believersNo = num(p.believers_no);
    const mixed = num(p.mixed_wallets);
    const directional = believersYes + believersNo;
    const pYes = peopleYesPct(believersYes, believersNo);
    const pNo = peopleNoPct(believersYes, believersNo);
    const moneyYes = numOrNull(state.money_yes_pct);
    const capHeldYes = num(p.capital_held_yes);
    const capHeldNo = num(p.capital_held_no);

    // Activity windows (events)
    const volEth = {
      "1h": num(e.volume_eth_1h),
      "24h": num(e.volume_eth_24h),
      "7d": num(e.volume_eth_7d),
    };
    const volUsd = {
      "1h": volEth["1h"] * ethUsd,
      "24h": volEth["24h"] * ethUsd,
      "7d": volEth["7d"] * ethUsd,
    };
    const buy24 = num(e.buy_count_24h);
    const sell24 = num(e.sell_count_24h);
    const totalCapitalUsd = num(state.yes_capital_usd) + num(state.no_capital_usd);

    // Transitions
    const nb = {
      "1h": num(t.new_believers_1h),
      "24h": num(t.new_believers_24h),
      "7d": num(t.new_believers_7d),
    };
    const nbSide = (t.nb_side_24h as "YES" | "NO" | null) ?? null;

    // Price changes: reuse the existing trustworthy snapshot-based figures; NULL
    // when there is no prior observation (never treat missing history as zero).
    const yesChg1h = numOrNull(state.chg_1h);
    const yesChg24h = numOrNull(state.chg_24h_yes ?? state.chg_24h);

    // Milestone: only when a believer threshold was crossed within the 24h window.
    const rung = believerMilestoneAtOrBelow(directional);
    const milestone = rung != null && nb["24h"] > 0 && directional - rung < nb["24h"] ? rung : null;

    const liveInput: LiveLineInput = {
      now,
      newBelievers: nb,
      newBelieversSide: nbSide,
      volumeUsd: volUsd,
      tradeCount: {
        "1h": num(e.trade_count_1h),
        "24h": num(e.trade_count_24h),
        "7d": num(e.trade_count_7d),
      },
      buyCount24h: buy24,
      sellCount24h: sell24,
      directionalBelievers: directional,
      directionalBelieversMilestone: milestone,
      peopleYesCrossed: null, // no reliable people% history yet (deferred to Phase 5 buckets)
      peopleYesCrossedAt: null,
      firstTradeAt: (e.first_trade_at as string) ?? null,
      lastTradeAt: (e.last_trade_at as string) ?? null,
      isFirstTrade: num(e.total_trades) === 1,
    };
    const liveLine = selectLiveLine(liveInput);

    const createdAt = (mkt.data?.created_at as string) ?? null;
    const lastTradeAt = (e.last_trade_at as string) ?? null;
    const version = num(state.read_model_version) + 1;

    const update: Record<string, unknown> = {
      // participation
      believers_yes: believersYes,
      believers_no: believersNo,
      believers_mixed: mixed,
      directional_believers: directional,
      active_positions: num(p.active_positions),
      people_yes_pct: pYes,
      people_no_pct: pNo,
      divergence: divergencePctPoints(pYes, moneyYes),
      capital_held_yes: capHeldYes,
      capital_held_no: capHeldNo,
      capital_held_total: capHeldYes + capHeldNo,
      side_balance: directional > 0 ? (believersYes - believersNo) / directional : null,
      // tenure / conviction evidence
      avg_directional_days: numOrNull(p.avg_directional_days),
      median_directional_days: numOrNull(p.median_directional_days),
      p75_directional_days: numOrNull(p.p75_directional_days),
      avg_conviction_strength: numOrNull(p.avg_conviction_strength),
      median_conviction_strength: numOrNull(p.median_conviction_strength),
      // activity windows
      trade_count_1h: num(e.trade_count_1h),
      trade_count_24h: num(e.trade_count_24h),
      trade_count_7d: num(e.trade_count_7d),
      buy_count_1h: num(e.buy_count_1h),
      buy_count_24h: buy24,
      sell_count_1h: num(e.sell_count_1h),
      sell_count_24h: sell24,
      volume_eth_1h: volEth["1h"],
      volume_eth_24h: volEth["24h"],
      volume_eth_7d: volEth["7d"],
      unique_wallets_1h: num(e.unique_wallets_1h),
      unique_wallets_24h: num(e.unique_wallets_24h),
      unique_wallets_7d: num(e.unique_wallets_7d),
      new_believers_1h: nb["1h"],
      new_believers_24h: nb["24h"],
      new_believers_7d: nb["7d"],
      side_flips_24h: num(t.side_flips_24h),
      // circulation (USD volume ÷ USD capital; null when capital is zero)
      circulation_1h: circulation(volUsd["1h"], totalCapitalUsd || null),
      circulation_24h: circulation(volUsd["24h"], totalCapitalUsd || null),
      circulation_7d: circulation(volUsd["7d"], totalCapitalUsd || null),
      buy_sell_ratio_24h: buySellRatio(buy24, sell24),
      sell_rate_24h: sellRate(buy24, sell24),
      // movement
      yes_price_change_1h: yesChg1h,
      yes_price_change_24h: yesChg24h,
      // lifecycle
      market_created_at: createdAt,
      first_trade_at: (e.first_trade_at as string) ?? null,
      last_trade_at: lastTradeAt,
      last_position_change_at: (t.last_position_change_at as string) ?? null,
      market_age_days: marketAgeDays(createdAt, now),
      inactive_for_seconds: inactiveForSeconds(lastTradeAt, now),
      // live line (factual, global)
      live_line: liveLine?.line ?? null,
      live_line_kind: liveLine?.kind ?? null,
      live_line_window: liveLine?.window ?? null,
      live_line_occurred_at: liveLine?.occurredAt ?? null,
      live_line_payload: liveLine?.payload ?? null,
      // freshness
      events_updated_at: (e.last_trade_at as string) ?? nowIso,
      positions_updated_at: nowIso,
      pov_updated_at: (state.updated_at as string) ?? null,
      calculated_at: nowIso,
      read_model_version: version,
      needs_rebuild: false,
      rebuild_reason: null,
      updated_at: nowIso,
    };

    // ── Global opportunity (Phase 5): classify + score from the just-computed
    //    factual metrics + POV display state. Pure engine, no viewer data.
    const inputRow: Record<string, unknown> = {
      onchain_id: market,
      ...update,
      yes_price_usd: state.yes_price_usd,
      no_price_usd: state.no_price_usd,
      money_yes_pct: moneyYes,
      yes_capital_usd: state.yes_capital_usd,
      no_capital_usd: state.no_capital_usd,
      market_created_at: createdAt,
    };
    const opp = evaluateOpportunity(buildOpportunityInput(inputRow, now), {
      nowMs: now,
      eligibleMarketCount,
      prevType: (state.opportunity_type as OpportunityType | null) ?? null,
    });
    const oppReason = opp.reasonCode ? renderReason(opp.reasonCode, opp.evidence) : null;
    const prevType = (state.opportunity_type as string | null) ?? null;
    const typeChanged = opp.type !== prevType;
    Object.assign(update, {
      opportunity_type: opp.type,
      opportunity_score: opp.normalizedScore,
      opportunity_score_raw: opp.rawScore,
      opportunity_reason_code: opp.reasonCode,
      opportunity_reason: oppReason,
      opportunity_window: opp.window,
      opportunity_sample_size: opp.sampleSize,
      opportunity_confidence: opp.confidence,
      opportunity_evidence: opp.evidence,
      opportunity_eligible: opp.eligible,
      opportunity_ineligible_reason: opp.ineligibleReason,
      opportunity_calculated_at: nowIso,
      opportunity_engine_version: OPP.ENGINE_VERSION,
      opportunity_previous_type: typeChanged ? prevType : (state.opportunity_previous_type ?? null),
      opportunity_type_since: typeChanged
        ? nowIso
        : ((state.opportunity_type_since as string) ?? nowIso),
    });

    const res = await sb
      .from("market_state")
      .upsert({ onchain_id: market, ...update }, { onConflict: "onchain_id" });
    if (res.error) return { market, ok: false, error: res.error.message };
    return {
      market,
      ok: true,
      version,
      liveLineKind: liveLine?.kind ?? null,
      opportunityType: opp.type,
    };
  } catch (err) {
    return { market, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Claim + refresh a bounded batch of dirty markets. Failures re-enqueue. */
export async function refreshDirtyBatch(
  sb: SB,
  limit = 100,
): Promise<{ processed: number; ok: number; failed: number; results: RefreshResult[] }> {
  const { data: claimed } = await sb.rpc("claim_market_refresh", { p_limit: limit });
  const markets = ((claimed ?? []) as { market_id: number }[]).map((r) => Number(r.market_id));
  if (markets.length === 0) return { processed: 0, ok: 0, failed: 0, results: [] };

  // One eth/usd calibration for the whole batch.
  const { data: eth } = await sb.rpc("eth_usd_calibration");
  const ethUsd = Number(eth ?? 0) || 0;
  // Comparison-pool size for the opportunity engine's percentile availability.
  const { count: poolCount } = await sb
    .from("market_state")
    .select("*", { count: "exact", head: true })
    .gt("directional_believers", 0);
  const eligibleMarketCount = poolCount ?? 0;

  const results: RefreshResult[] = [];
  let ok = 0;
  let failed = 0;
  for (const m of markets) {
    const r = await refreshMarket(sb, m, ethUsd, eligibleMarketCount);
    results.push(r);
    if (r.ok) ok += 1;
    else {
      failed += 1;
      // Re-enqueue for a retry (coalesced).
      await sb.rpc("enqueue_market_refresh", { p_market_ids: [m], p_kind: "activity" });
    }
  }
  return { processed: markets.length, ok, failed, results };
}
