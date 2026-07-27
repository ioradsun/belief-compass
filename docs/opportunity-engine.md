# Global opportunity engine (Phase 5)

One pure engine (`src/domain/opportunity.ts`) classifies + scores each market from
canonical `market_state` facts ONLY — no viewer data. Output is stored on the same
`market_state` row by the refresher; the center feed reads it in score order. The
client performs no opportunity math.

## Legacy lens inventory — kept / merged / retired

| Legacy label / score | Was | Decision |
|---|---|---|
| Hot (`feed-lenses.scoreFeed`) | client per-lens score | **retired client scoring** → `hot` (server) |
| Conviction | client lens (tenure-weighted) | **redefined** `conviction` with circulation/challenge gating |
| Early | client lens | `early` (server) |
| Hidden | client lens | `hidden` (server) |
| Momentum | (implicit in Hot) | **merged** into `hot` (acceleration) |
| Contested / Against the Crowd | not a lens / implicit | **added** `contested` (factual) |
| New | none | **added** `new` (fallback) |
| Tribe / Rivals / People Like You / Picked for You | client viewer lenses | **removed from opportunity** → Phase 6 relationship control |
| `scoreFeed()` (client) | client ranking | **removed** from the center (`index.tsx`) |

`src/lib/feed-lenses.ts` is now unreferenced by the app (kept with its unit test;
superseded by this engine — a candidate for deletion in a later cleanup phase).

## The six types
`hot` (broad recent activity accelerating now — needs absolute floor AND
acceleration) · `early` (real growth with low maturity) · `hidden` (circulation +
breadth beyond visible size, denominator-guarded) · `contested` (balanced sides
with recent activity) · `conviction` (persistence **under challenge**) · `new`
(recent-market fallback). No other types this phase.

## Eligibility gates (ineligible codes)
`missing_market_time` · `missing_price_state` · `stale_market_state` (calculated_at
older than `STALE_SECONDS`) · `invalid_capital` · `no_participation` (no 7d trades
and no directional believers) · `insufficient_evidence` (eligible but no type
qualified and not recent → excluded, never mislabeled).

## Thresholds (all in `src/domain/opportunity-config.ts`)
`NEW_MARKET_MAX_HOURS=72` · `STALE_SECONDS=1800` · `CAPITAL_FLOOR_USD=100` ·
`MIN_ACTIVITY_WALLETS=3` · `MIN_DIRECTIONAL_BELIEVERS=4` ·
`MIN_CONTESTED_SIDE_BELIEVERS=2` · `MIN_CONVICTION_COHORT=4` ·
`MIN_MARKETS_FOR_PERCENTILES=20` · Hot: `HOT_MIN_UNIQUE_WALLETS_1H=3`,
`HOT_MIN_ACCEL=1.6`, `HOT_BASELINE_FLOOR=0.5`, `HOT_STRONG_STRENGTH=0.55` · Early:
`EARLY_MAX_DIRECTIONAL=40`, `EARLY_MIN_NEW_BELIEVERS=3` · Hidden:
`HIDDEN_MAX_CAPITAL_USD=5000`, `HIDDEN_MIN_CIRCULATION=1.0`, `HIDDEN_MIN_WALLETS=3`,
`HIDDEN_MAX_CONCENTRATION=0.6` · Contested: `CONTESTED_BALANCE_MIN=0.6`,
`CONTESTED_MIN_RECENT_TRADES=4` · Conviction: `CONVICTION_MIN_MEDIAN_DAYS=7`,
`CONVICTION_MIN_STRENGTH=0.4`, `CONVICTION_MIN_CIRCULATION_7D=0.5`. Chosen for the
current small production scale; tune only these.

## Evidence ladder & percentiles
Each type evaluates the narrowest useful window first (1h → 24h → 7d → lifecycle)
and the result **discloses** `window` + `sample_size`. Cross-market percentiles are
**disabled** below `MIN_MARKETS_FOR_PERCENTILES` eligible markets; at current scale
the engine uses absolute thresholds + log-scaled values and lowers confidence
(`percentiles_available:false` in evidence). No 90th percentile over four markets.

## Concentration protection
A proxy from canonical fields only — `trades_per_wallet = trade_count_24h /
unique_wallets_24h` mapped to 0..1. Used as a Hidden disqualifier (`> 0.6`) and a
score penalty. Full per-wallet share is deferred (needs per-wallet aggregation).

## Classification precedence (Stage B, documented)
Hot wins first **only when unusually strong** (`strength ≥ HOT_STRONG_STRENGTH`);
otherwise ordered precedence: **hot → contested → conviction → early → hidden →
new**. A type only reaches selection if its gates (which embed strength/challenge
minimums) pass. `new` is last (fallback); if nothing qualifies and the market
isn't recent, it's excluded (`insufficient_evidence`).

## Scoring (0..100)
`raw = W_GLOBAL_QUALITY·quality + W_TYPE_STRENGTH·typeStrength + confidenceBonus`,
then `normalized = clamp(raw − stalenessPenalty − concentrationPenalty, 0, 100)`.
`quality` is a log-scaled blend of unique wallets, volume, believers and
circulation (no raw units summed; no single whale dominates). Classification is
separate from scoring — the label is not "whichever number is biggest".

## Confidence
`low | medium | high` from sample size, breadth, window narrowness, concentration,
and percentile availability — evidence QUALITY, never predicted profitability. `new`
is always low; tiny/concentrated samples are low; broad fresh multi-signal is high.

## Reason codes
`HOT_ACCELERATING_BREADTH` · `HOT_ACCELERATING_VOLUME` · `EARLY_NEW_BELIEVERS` ·
`EARLY_BREADTH_WITH_LOW_MATURITY` · `HIDDEN_HIGH_CIRCULATION_LOW_CAPITAL` ·
`CONTESTED_BALANCED_ACTIVE_SIDES` · `CONTESTED_PEOPLE_MONEY_DISAGREEMENT` ·
`CONVICTION_PERSISTENCE_UNDER_CHALLENGE` · `CONVICTION_BREADTH_WITH_CIRCULATION` ·
`NEW_RECENT_MARKET`. `render-reason.ts` renders factual copy from the evidence
payload (real numbers, discloses window, no certainty/motive/"everyone"/Tribe/Rival).

## Hysteresis
The current label is kept unless a new winner beats the current type's strength by
`HYSTERESIS_MARGIN=0.12` (or the current type no longer qualifies). `opportunity_
type_since` / `opportunity_previous_type` record transitions. Score may update every
refresh; the label is sticky at boundaries.

## Compute path & cutover
Opportunity is computed inside the existing dirty-market refresh (no second sweep):
refresh factual metrics → `buildOpportunityInput` → `evaluateOpportunity` →
hysteresis → write opportunity fields on the same row → bump `read_model_version`.
The center (`getMarkets`) orders eligible markets by `opportunity_score` server-side
(pre-warm fallback to window volume so the feed is never empty); `index.tsx` filters
by the canonical `opportunity_type` and renders `opportunity_reason` — no client
scoring. The dropdown is a filter over the one classification, not a second engine.

## Diagnostics & explainability
`npm run check:opportunities` (per-market / `--type` / `--low` / `--dirty` / `--stale`)
recomputes vs stored and checks structural invariants; exits nonzero on violations.
`debugEvaluate(input, ctx)` returns per-type candidacy + eligibility + score for tuning.

## Deferred to Phase 6
Personal relevance on top of these global candidates (Tribe/Rival, viewer positions)
— without changing global truth; a hard deletion of the superseded `feed-lenses.ts`;
full per-wallet concentration; and people%-history-based price-driven signals.
