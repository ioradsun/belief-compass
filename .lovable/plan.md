# Now Feed — Anomaly & Early-Signal Layer (revised)

No code changed yet. Revised after your storytelling note. The architecture holds; the premise changes.

**Mission (top of the implementation spec):** Now is your private investigator for conviction. It does not predict. It watches people, money, conviction and price, and reports changes a person casually watching would miss. It presents the smallest set of facts needed for the reader to notice the thing themselves — and stops before explaining it.

Rank by **information gain**, not activity. BUILDING / DIVERGING / REVERSING / CONFIRMING remain internal machinery and never appear in copy.

---

## 1. Current architecture (verified)

Built once per fetch in `buildTape()` (`src/lib/live.functions.ts:615`):

```text
events (72h, canonical, LIVE_KINDS, limit*3) + market_state (8 cols) + titles + eth/usd
  → groupLiveRows        (live-tape.ts)      churn → wash → sweeps → bursts
  → tellPiStory / legacy  (pi-voice.ts, legacy-voice.ts)
  → scoreFeedEvent        (feed-event.ts)    0.5*magnitude + 0.2*speed + 0.3*novelty, × relevance
  → significance.ts       one 0..1 scale, tier floors, compose()
  → adaptiveFloor/admit   (feed-density.ts)
  → + viewerBoost + stakeBoost  (viewer-relationship.ts, viewer-stake.ts)
  → mix candidate {family, significance, discovery, motif, subjects}
  → editFeed              (feed-editorial.ts) earnsSlot → collapseCausal → pruneRepeats → capFamilies
  → findPersonPatterns    (person-pattern.ts) asides only
  returns UNORDERED
  → mixFeed               (feed-cadence.ts:313) 0.7*quality + 0.3*recency − adjacency − dominance
                          quality = sig + (1−sig)*0.85*discovery; sig ≥ 0.8 skips the queue
```

`src/domain/feed/*` is the separate markets/opportunity queue. Not touched.

## 2. Data available (verified)

Queried today: believers YES/NO, `new_believers_1h`, `money_yes_pct`, `people_yes_pct`, `opportunity_type`, `market_age_days`, plus per-row amount/side/action/wallet and tenure from `wallet_beliefs`.

On the **same `market_state` row**, already stored, currently unselected — this is the anomaly feedstock:

| Signal | Columns |
| --- | --- |
| price moved | `yes_price_change_1h/24h/7d` |
| capital moved | `yes_capital_delta_24h`, `no_capital_delta_24h`, `yes/no_capital_usd` |
| people moved | `new_believers_yes_24h`, `new_believers_no_24h`, `people_yes_change_24h`, `side_flips_24h` |
| velocity | `trade_count_1h/24h/7d`, `unique_wallets_1h/24h/7d`, `volume_eth_1h/24h/7d`, `buy_sell_ratio_24h`, `sell_rate_24h` |
| unusualness | this market's 1h rate vs its own 24h/7d rate — all three windows on the row |
| silence / dormancy | `last_trade_at`, `inactive_for_seconds`, `first_trade_at` |

Not read at read time: `market_state_snapshots` / `price_snapshots` (true price path) and `market_transition_state` (memory of what we already said). Both cron-side today. `market_window_change` and `chg_24h_yes` are empty per existing code comments — do not build on them.

## 3. Signal vector, not a single state

`Pressure.state` as one enum throws away the reason a story is interesting. Replace with a vector:

```ts
interface Pressure {
  signals: {                 // each 0..1, independent, can all be non-zero
    building: number;        // participation/capital forming
    divergence: number;      // two signals that belong together have separated
    reversing: number;       // conviction weakening or turning
    confirmation: number;    // price consistent with an earlier observable pattern
    silence: number;         // the dog that didn't bark
  };
  velocity: number;          // rate now vs this market's own baseline
  unusualness: number;       // how abnormal this is FOR THIS MARKET
  informationGain: number;   // 0..1 — the ranking number (see §5)
  primary: SignalKey;        // largest signal, for copy selection only
  tension?: TensionKind;     // the specific contradiction, when divergence > 0
  reasons: string[];         // explainability
}
```

`tension` is the premium inventory and is named explicitly so copy can be specific: `people_up_capital_down`, `capital_up_price_flat`, `price_up_believers_flat`, `believers_left_price_rose`, `whales_out_newcomers_in`, `tribe_against_market`.

`silence` covers "nothing happened when something was expected": money landed and price hasn't budged four hours later; a lone position nobody followed; a price jump no believer followed. Computationally a subtype of divergence, editorially its own voice.

## 4. CONTEXT has no pressure

Corrected from the previous draft. Social and personal rows (Tribe/Rival/Twin activity, milestones, cohorts, new markets, `showed_up`, `standing_fact`) carry **no pressure signals at all** — not weak ones. Their vector is zero and they rank entirely on the existing personal axis (`viewerBoost` + `stakeBoost` + `discovery`). A Rival flipping is high personal relevance with zero market pressure, and the ranker should be able to say exactly that instead of pretending it is a small market signal.

Exception: a person-driven row that also carries market weight (the 32-day whale exiting) gets both — a real `reversing` signal *and* personal relevance, because both are true.

## 5. Information gain replaces event-kind importance

The ranking principle, stated as the design rule: *how much does knowing this change what the reader understands about this market?*

`informationGain` composes (via the existing `compose()` in `significance.ts`, not a new combinator):

- magnitude of change, **market-relative first** (a $2 trade in an active market ≈ 0; the first $2 ever on NO is not)
- number of independent people behind it
- tension present (largest single contributor — contradictions are the premium)
- velocity and unusualness relative to this market's own baseline
- person notability (tenure, largest holder, repeated intersection with the reader)

Ranking touches, both subtractive:

1. `significance.ts` — `informationGain` becomes a `compose()` part on the derived path. No migration, emitted scores untouched.
2. `feed-cadence.ts` — add `primary` + `tension` to `MixCandidate` and use them **only for variety**: cap consecutive rows sharing a primary signal (like `MAX_SAME_FAMILY_RUN`), small target bonus when tension rows are absent from the window. `breakingAt` stays on significance alone.

## 6. Three voice levels, with enforced scarcity

`pi-voice.ts` receives the vector and picks a register:

| Level | When | Shape |
| --- | --- | --- |
| **Receipt** | no tension, low gain | "Alex pulled $15 from YES." |
| **Observation** | single-signal, real change | "YES IS THINNING OUT / Three holders have left today." |
| **Intelligence** | tension or high unusualness | "THE PEOPLE STAYED. THE MONEY DIDN'T. / Nine new believers joined. $85 left." |

Hard cap: **Intelligence rows are at most ~25% of any window**, enforced in the cadence pass. Over budget, the weaker ones drop to Observation. Scarcity is the credibility mechanism; the ratio is a tested invariant, not a vibe.

Copy rules: the contrast fact must be present and last ("Price hasn't moved yet."), then stop. No explanation, no "why", no headline that is only a reaction word. The existing hype-word ban stays and gains `ODD ONE`-style reaction headlines unless a specific contrast follows.

## 7. CONFIRMING is gated, not shipped

Your objection is correct and the audit already suspected it: knowing an entry happened at 10:00 and that the 24h change is +11% does **not** license "since then, +11%". The window can predate the entry.

So: `confirmation` stays in the vector but **emits nothing** until we can prove temporal order from price observations. Two options, decided when we get there:

- read a bounded `price_snapshots` / `market_state_snapshots` lookup for the small set of markets that have a candidate build event in-batch, or
- ship only the strictly factual conjunction — "$244 entered YES. It's also up 11% today." — which claims no ordering.

Nothing in phase 1 says "since then". One suspicious inference and the feed stops being believed.

## 8. Developing story (memory) — feasible, unchanged

`buildTape` already holds the 72h batch with `market_id`, `side`, `occurred_at`, `amount`, `source_key`, and `feed-editorial.collapseCausal` already correlates `(marketId, side)` within 6h to *suppress*. The same index can *connect*. Caveat stated honestly: the batch is `limit*3` events across all markets, so an older build event can fall out of the window — absent link, the row stays as it is today. No fabrication, no new table.

## 9. Missing data

- **Intraday price path** — blocks temporal confirmation (§7).
- **Cross-poll memory** — no record of what a reader already saw, so a developing story can restate itself between polls. Motif pruning limits this within a window; if it annoys, fix client-side, not with a table.

## 10. Smallest safe sequence

1. Widen the `market_state` select in `loadTapeSource` to §2 columns; extend `Momentum`. Behaviour-neutral.
2. Add `src/domain/pressure.ts` (vector, tension, silence, informationGain) + tests. Unused at first.
3. Attach the vector to rows in `buildTape`; review in the dev voice lab (`/dev/voice`) with nothing wired to ranking.
4. Wire `informationGain` into the derived branch of `significance.ts`.
5. Voice levels + Intelligence budget in `pi-voice.ts` and the cadence pass.
6. Variety caps on `primary`/`tension` in `feed-cadence.ts`.
7. Confirmation only after §7's temporal proof exists.

## 11. Tests and invariants

- **Vector**: signals are independent — a case with people↑, capital flat, price flat, 6× normal activity yields non-zero `building`, `divergence` and `unusualness` simultaneously.
- **CONTEXT purity**: social/personal kinds return an all-zero pressure vector. Asserted per kind.
- **Causality ban**: no generated copy contains "caused", "because", "drove", "sent", "since then" (the last until §7 is satisfied).
- **Scarcity**: Intelligence-level rows never exceed the budget share in a mixed window.
- **Market-relative**: a $5 arrival in an active market ranks below a $5 first-capital arrival on an empty side.
- **Silence**: a stale build with no price response emits a silence row only after the expectation window, and only once.
- **Regression**: full suite green; existing `feed-cadence` breaking-band and dominance tests unchanged; `buildTape` output unchanged after step 1.

## Technical notes

Files: `src/lib/live.functions.ts`, new `src/domain/pressure.ts` (+ test), `src/domain/significance.ts`, `src/domain/feed-editorial.ts`, `src/domain/feed-cadence.ts`, `src/domain/pi-voice.ts`. No migrations, no new tables, no cron, no second scoring engine; `src/domain/feed/*` untouched.
