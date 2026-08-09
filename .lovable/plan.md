# Now Feed — Pressure Hierarchy Audit and Smallest Safe Change

No code changed. This is the audit you asked for, plus the minimum implementation sequence.

Verdict up front: the four-state model can be built almost entirely from data we already store, but **not from data the Now feed currently loads**. `buildTape` reads only 8 columns of `market_state` today. Every interval metric the hierarchy needs (price change 1h/24h, capital deltas 24h, believer deltas, trade/wallet counts, last trade time) already exists on the same row and is simply not selected. That is the single biggest finding: the pressure layer is mostly a wider `SELECT`, not a new engine.

---

## 1. Current architecture

The Now tape is built once per fetch in `buildTape()` (`src/lib/live.functions.ts:615`):

```text
events (72h, canonical, LIVE_KINDS, limit*3)
  + market_state (8 columns) + titles + eth/usd
        ↓ groupLiveRows            (src/lib/live-tape.ts)  churn → wash → sweeps → bursts
        ↓ tellPiStory / legacy     (pi-voice.ts, legacy-voice.ts)
        ↓ scoreFeedEvent           (feed-event.ts)   0.5*magnitude + 0.2*speed + 0.3*novelty, × relevance
        ↓ scoreLiveAction etc.     (significance.ts) one 0..1 scale, tier floors, compose()
        ↓ adaptiveFloor/admit      (feed-density.ts)
        ↓ + viewerBoost + stakeBoost  (viewer-relationship.ts, viewer-stake.ts) additive, capped at 1
        ↓ mix candidate            {family, significance, discovery, motif, subjects}
        ↓ editFeed                 (feed-editorial.ts) earnsSlot → collapseCausal → pruneRepeats → capFamilies
        ↓ findPersonPatterns       (person-pattern.ts) asides only, no new rows
        ↓ pace annotate            (feed-scheduler.ts)
   returns UNORDERED rows
        ↓ mixFeed                  (feed-cadence.ts:313) 0.7*quality + 0.3*recency − adjacency − dominance + targets
                                    quality = sig + (1−sig)*0.85*discovery; sig ≥ 0.8 skips the queue
```

Important: `src/domain/feed/*` (score/pool/sequence/momentum/config) is the **markets/opportunity queue**, a different surface. Do not touch it for this work.

Also relevant: `story-event.ts` already emits interval-aware transitions (`people_capital_divergence`, `price_conviction_divergence`, `market_reawakened`, `accelerating`, `losing_conviction`), but they are produced by a **cron** (`story-event-emit.server.ts`) reading `market_state_snapshots`, not at read time.

## 2. Existing data available for each signal

Already queried by the tape: believers YES/NO, `new_believers_1h`, `money_yes_pct`, `people_yes_pct`, `opportunity_type`, `market_age_days`, plus per-row amount/side/action/wallet/tenure (`wallet_beliefs`).

Available on the **same `market_state` row** and unqueried — this is the pressure feedstock:

| Signal | Column(s) |
| --- | --- |
| priceMoved | `yes_price_change_1h`, `yes_price_change_24h`, `yes_price_change_7d` |
| capitalMoved | `yes_capital_delta_24h`, `no_capital_delta_24h`, `yes_capital_usd`, `no_capital_usd` |
| peopleMoved | `new_believers_yes_24h`, `new_believers_no_24h`, `people_yes_change_24h`, `side_flips_24h` |
| velocity | `trade_count_1h/24h`, `unique_wallets_1h/24h`, `volume_eth_1h/24h`, `buy_sell_ratio_24h`, `sell_rate_24h` |
| unusualness | this market's 1h vs its own 24h/7d rate (all three windows are on the row) |
| dormancy / reawakening | `last_trade_at`, `inactive_for_seconds`, `first_trade_at` |

Not available at read time without new IO: true multi-point price history (`market_state_snapshots`, `price_snapshots`) and any memory of what we told the reader before (`market_transition_state`). Both are cron-side today.

Personal relevance already exists: `viewerBoost`, `stakeBoost`, `relByWallet`/`labelByWallet`, `discovery`.

## 3. Event → interpretation matrix

Every existing event kind stays. Interpretation is derived, never emitted.

| Event family | Default state | Escalates to | Basis |
| --- | --- | --- | --- |
| trade BUY / burst / large_trade / "not done" | BUILDING | DIVERGING if `yes_price_change_1h` ≈ 0 while capital delta is large; CONFIRMING if price moved with the side | amount, wallet count, price delta |
| side_opened / went_first / first_capital | BUILDING (strong: zero base) | — | first-event taxonomy |
| trade SELL / believer_left / OUT / ONE LESS / capital leaving | REVERSING | strength scales with tenure and share of side capital | `daysHeld`, capital delta share |
| position_changed_side / FLIPPED | REVERSING | DIVERGING if the market's price is moving the other way | abandoned side + tenure |
| market_transition `people_capital_divergence`, `price_conviction_divergence`, `market_dividing` | DIVERGING | — | already emitted as contradictions |
| market_transition `accelerating`, `participation_broadening`, `concentration_rising`, `capital_milestone`, `side_doubled` | BUILDING | — | emitted |
| market_transition `majority_flipped`, `losing_conviction`, `market_balanced` | REVERSING | — | emitted |
| market_transition `material_move` | CONFIRMING if prior same-side build exists in the batch, else CONTEXT | — | in-batch linkage (§6) |
| market_reawakened | BUILDING (weak reawaken stays quiet, as today) | — | existing trade-count gate |
| believer_milestone, tribe_doubled, conviction_cohort, person_milestone, standing_fact, market_created, showed_up, discovery_moment, wallet_sweep | CONTEXT | promoted only by personal relevance | social texture |

CONFIRMING is the only genuinely new narrative and is derived, never causal: "Three people brought $244 into YES. Since then, YES is up 11%." — two facts joined by "since then".

## 4. Proposed strength model

One small pure module, `src/domain/pressure.ts`, exporting:

```ts
type StoryState = "BUILDING" | "DIVERGING" | "REVERSING" | "CONFIRMING" | "CONTEXT";

interface Pressure {
  state: StoryState;
  strength: number;          // 0..1, via the existing compose() from significance.ts
  priceMoved: number;        // 0..1
  peopleMoved: number;       // 0..1
  capitalMoved: number;      // 0..1
  velocity: number;          // 0..1  (1h rate vs this market's own 24h rate)
  unusualness: number;       // 0..1  (same, market-relative — never absolute)
  reasons: string[];         // explainability, same convention as Significance
}
```

Rules: reuse `compose()` and `clamp01`/`sat` rather than inventing a second combinator. All inputs market-relative first, absolute second — the same discipline `feed-event.magnitude` already uses. `CONTEXT` strength is capped below the notable band (0.5) so it cannot outrank real pressure on the market axis alone.

## 5. Ranking changes (subtractive)

No new scoring engine. Two touches:

1. `significance.ts` — feed `pressure.strength` in as one more `compose()` part on the existing derived path, so BUILDING with real velocity lifts and CONTEXT does not. No change to emitted-score persistence, no migration.
2. `feed-cadence.ts` — add `state` to `MixCandidate` and use it in the **variety** rules only: cap consecutive rows of the same `StoryState` (like the existing `MAX_SAME_FAMILY_RUN`), and let `DIVERGING`/`CONFIRMING` take a small target-bonus when absent from the window. `breakingAt` stays on significance alone.

Personal relevance keeps its existing separate axis (`viewerBoost` + `stakeBoost` + `discovery` lift). That already gives the two-axis behaviour you described: "your rival joined your side" is CONTEXT on the market axis but wins on the personal one.

## 6. Developing-story feasibility

Feasible today, no persisted state. `buildTape` already holds the whole 72h batch in memory with `market_id`, `side`, `occurred_at`, `amount`, `source_key`, and `feed-editorial.collapseCausal` already correlates `(marketId, side)` pairs inside a 6h window — it just uses the link to *suppress*. We extend the same index to also *connect*: if an earlier BUILDING row on `(market, side)` precedes a later material price move on the same side, the later row becomes CONFIRMING and carries a reference to the earlier fact. One caveat to state honestly: the batch is `limit*3` events across all markets, not N per market, so on a busy platform an older build event can fall out of the window and the link is simply absent. Absent link → row stays as it is today. No fabrication.

## 7. Missing data

Only two gaps, and neither blocks phase 1:

- **Intraday price path.** We can see "price moved over 1h/24h" but not "when it moved". Enough for CONFIRMING as chronology; not enough to say "price moved *after* the money". Mitigation: require the build event to be older than the price window's start, or accept the weaker phrasing.
- **Cross-poll memory.** No record of which stories a reader already saw, so a developing story can restate itself between polls. Existing motif pruning limits this within a window. If it proves annoying, the fix is client-side seen-motif state, not a table.

`market_window_change` and `chg_24h_yes` are effectively empty per existing code comments — do not build on them.

## 8. Smallest safe implementation sequence

1. Widen the `market_state` select in `loadTapeSource` to the columns in §2 and extend `Momentum`. Behaviour-neutral. (One query, same row count.)
2. Add `src/domain/pressure.ts` + tests. Pure, unused at first.
3. Attach `pressure` to each row's story/mix in `buildTape`. Still unranked — verify in the dev voice lab.
4. Wire `pressure.strength` into the derived branch of `significance.ts`.
5. Add the `(market, side)` chronology index in `feed-editorial.ts` and emit CONFIRMING.
6. Add `state` variety caps in `feed-cadence.ts`.
7. Give `pi-voice.ts` the interpretation so copy leads with the state ("YES is getting crowded", "The crowd grew. The money left.").

Each step ships independently and is revertible.

## 9. Tests and invariants required

- `pressure.test.ts`: every existing kind maps to exactly one state; CONTEXT strength never exceeds 0.5; strength is monotonic in capital/people/velocity; zero-data markets return CONTEXT, not BUILDING.
- Causality invariant: no generated copy may contain "caused", "because", "drove", "sent" — assert against the CONFIRMING corpus.
- Chronology invariant: CONFIRMING only emits when the build event's `occurredAt` precedes the price window.
- Ranking invariants: existing `feed-cadence` breaking-band and dominance tests must still pass unchanged; add one asserting a $5 arrival in an active market ranks below a $5 first-capital arrival on an empty side.
- Regression: full suite (2,325 tests) green; `buildTape` snapshot unchanged after step 1.

## Technical notes

Files touched, in order: `src/lib/live.functions.ts`, new `src/domain/pressure.ts` (+ test), `src/domain/significance.ts`, `src/domain/feed-editorial.ts`, `src/domain/feed-cadence.ts`, `src/domain/pi-voice.ts`. No migrations, no new tables, no new cron, no second scoring engine, and `src/domain/feed/*` (the markets queue) is not touched.
