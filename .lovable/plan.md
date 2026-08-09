# Now Feed — Anomaly-First Intelligence Layer (v3)

No code changed yet. Revised again: scoring is explicitly **anomaly-first, magnitude-supporting**, and the PI may foreground personal context *after* ranking.

**Mission (top of the implementation spec):** Now is your private investigator for conviction. It does not predict. It notices asymmetry before the reader does. Its job is not to answer "what happened?" but to make the reader think "wait — why is that happening?" It presents the smallest set of facts needed for the reader to notice the thing themselves, and stops before explaining it.

**The bar** (a fact belongs in the folder or it doesn't):
- "Three people bought YES." — no.
- "YES was empty an hour ago. Three wallets are in now. Price hasn't moved." — yes.
- "Nine people joined. $85 left." — yes.
- "Mike took NO." — maybe.
- "Mike normally lands opposite you. Today he's on your side." — yes.

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

On the **same `market_state` row**, stored and currently unselected — the anomaly feedstock:

| Signal | Columns |
| --- | --- |
| price moved | `yes_price_change_1h/24h/7d` |
| capital moved | `yes_capital_delta_24h`, `no_capital_delta_24h`, `yes/no_capital_usd` |
| people moved | `new_believers_yes_24h`, `new_believers_no_24h`, `people_yes_change_24h`, `side_flips_24h` |
| baseline / velocity | `trade_count_1h/24h/7d`, `unique_wallets_1h/24h/7d`, `volume_eth_1h/24h/7d`, `buy_sell_ratio_24h`, `sell_rate_24h` |
| concentration | `capital_held_yes/no/total`, `avg_conviction_strength`, plus largest-holder ordering already loaded by `loadBelieverFaces` |
| nonresponse | `last_trade_at`, `inactive_for_seconds`, `first_trade_at` |

Not read at read time: `market_state_snapshots` / `price_snapshots` (true price path) and `market_transition_state` (memory of what we already said). `market_window_change` and `chg_24h_yes` are empty per existing code comments — do not build on them.

**Pre-wiring audit task (step 2a):** answer one precise question before ranking depends on concentration — *can the pre-event holder hierarchy be reconstructed from event amount plus current beliefs?* `loadBelieverFaces` returns **current** largest holders, which does not prove who was largest *before* an exit. If it cannot be reconstructed, `largest_holder_left` and `newcomers_replaced_a_whale` wait for a bounded historical read. Never infer "a whale exited" from a large dollar amount alone. Audit `nonresponse` derivability in the same step.

### 2a findings (measured, 2026-08-09)

Corpus: 2,806 markets, 6,760 canonical trades (4,537 BUY / 2,223 SELL), 221 markets traded in 7d, 140 trades in 24h.

1. **Concentration is reconstructable — VERDICT: YES.** Cumulative net per `(market_id, wallet)` from the canonical event stream yields **2,891 pairs, exactly matching `wallet_beliefs`' 2,891**. Summing events up to an event timestamp therefore gives the *pre-event* holder hierarchy. Cost is small: 7.4 trades per market all-time. `largest_holder_left` is unblocked. **But** `newcomers_replaced_a_whale` is corpus-limited: mean holders per market is **2.0**, and only **63 markets** have ≥5 open positions. It stays defined and tested, and will simply rarely fire — it must never be loosened to "a big trade happened".
2. **`unusual` cannot use a 1h baseline — VERDICT: NO.** Median 7d hourly rate is **0.012 trades/hr**; only **3 markets** traded in the last hour and only **11** have ≥3 trades in 24h. Against that baseline a single trade is ~80× "normal", which is noise, not information. The canonical baseline must be **daily**: compare `trade_count_24h` against `trade_count_7d / 7`, gated on `trade_count_7d >= 7` (**49 markets** qualify; 15 usable today, 4 currently bursting). Below the guard, `unusual` returns zero — never a large number from a small denominator.
3. **The quiet band must be relative — VERDICT: relative only.** `yes_price_change_*` is an absolute USD delta, and median price is **$1.93** with median |24h move| **$0.166**. An absolute cent threshold would classify most of the book as either quiet or loud depending on price level. Quiet band = |Δprice| / price, with the observed median at **8.6%** and p90 at ~9.4% relative — the band gets calibrated from that distribution, not guessed.
4. **`nonresponse` is derivable but rare.** Inputs (capital delta, price change) are populated for **2,795/2,806** markets. The limiting factor is not data, it is that only ~60 markets see any 24h activity, so at most a handful of nonresponse candidates exist per build.
5. **One canonical baseline helper.** `unusual`, velocity, and the quiet band all call the same function; no second definition of "normal" anywhere.

## 3. Signal vector, not a single state

Named **`SignalVector`** (`src/domain/signal-vector.ts`), not `Pressure` — the system measures anomaly, contradiction, nonresponse and reversal, and "pressure" biases the implementation toward momentum.

```ts
interface SignalVector {
  signals: {                 // 0..1 each, independent, several can be non-zero
    tension: number;         // two things that travel together have separated
    beforePrice: number;     // people/capital/conviction moved, price still quiet
    unusual: number;         // abnormal FOR THIS MARKET vs its own baseline
    concentration: number;   // shape of the money changed (see below)
    reversing: number;       // conviction weakening or turning
    building: number;        // raw accumulation, no other signal
    nonresponse: number;     // meaningful input, observable response below threshold for N hours
    confirmation: number;    // computed, not emitted — see §7
  };
  tensionKind?: TensionKind;
  concentrationKind?: ConcentrationKind;
  informationGain: number;   // the ranking number (§5)
  primary: SignalKey;        // for copy selection only; never printed
  reasons: string[];
}
```

`TensionKind`: `people_up_capital_down`, `capital_up_price_flat`, `price_up_believers_flat`, `believers_left_price_rose`, `whales_out_newcomers_in`. All viewer-blind. "Tribe went the other way" is deliberately **not** a tension kind — it is viewer-relative and belongs to the angle layer (§7).

`ConcentrationKind`: `concentrating`, `distributing`, `largest_holder_left`, `newcomers_replaced_a_whale`. First-class because five wallets at $2 and one wallet at $200 are psychologically different, and "five people came in, one big holder walked out" explains the *shape* of a contradiction without inventing motive. The existing `concentration_rising` transition family feeds this rather than staying siloed. Gated on the §2 audit.

**`nonresponse`, precisely modelled.** Never "the expected move didn't happen" — we cannot establish expectation. The model is: *meaningful input occurred, and the observable response stayed below threshold for N hours.* Copy: "$200 entered YES four hours ago. Price is still basically where it was." Never: "Price should have moved by now." Scope: at most one surviving nonresponse story per underlying input **within a build/editorial window**. Cross-poll deduplication is explicitly not guaranteed until seen-state exists — and seen-state, when it comes, is client-side, not a table.

**`beforePrice`, precisely modelled.** "Quiet" is a measured band, never `priceChange === 0`: input signal above a defined materiality threshold **and** absolute price change below a market-relative quiet band. That is what licenses "Three wallets stepped in. Price is still basically where it was."

## 4. Social rows carry zero market signal — which is not the same as unimportant

Social/personal rows (Tribe/Rival/Twin activity, discovery moments, milestones, cohorts, new markets, `showed_up`, `standing_fact`) receive an **all-zero SignalVector**. Their existing significance and relevance behaviour is untouched — `significance.ts` already lets a Twin/Opp discovery reach the exceptional band and ordinary Tribe discovery reach high, and that stays exactly as it is.

Zero vector means "this row tells us nothing about market anomaly". It does not mean "this row is unimportant". Meeting a new Rival can be the most important thing in Now while carrying no market signal at all.

Exception: a person-driven row that also carries market weight — the 32-day whale exiting — gets both, because both are true.

## 5. informationGain is anomaly-first

The explicit hierarchy, highest to lowest. Magnitude is supporting evidence, never the lead.

1. **Contradiction / separation** — two things that normally travel together stopped.
2. **Change before price** — people/capital/conviction moved materially while price stayed quiet.
3. **Unusual for this market** — not "10 trades", but "5× this market's normal pace".
4. **Notable person changed behaviour — viewer-blind only.** Longest current holder, largest holder / Conviction Whale, full exit after 40 days, unusually large share of side capital, one actor appearing across several rapid events in this market. Explicitly **forbidden here**: Tribe, Rival, Twin, conviction match, repeated intersection with the reader, showing-up history, my position, my market. Those live on the personal axis and may change the angle after admission (§7).
5. **Strong raw movement** — large influx/outflow with no other signal.
6. **Ordinary activity** — Receipt, or suppressed.

Conceptually: `informationGain ≈ anomaly + tension + change-from-baseline + viewer-blind human significance`, with magnitude as corroboration. A smaller trade that breaks a market's pattern must be able to outrank a larger ordinary one — a tested invariant, not an aspiration. Composed with the existing `compose()` in `significance.ts`; no second combinator.

**Anomaly-first does not mean anomaly-overrides.** Information gain may lift a story within its truthful significance class; it may not manufacture structural importance. "$8 arrived at 4× normal velocity" must not outrank "the market majority flipped". `compose()`'s bounded shape mostly gives this for free — pin it with a test anyway.

**`building` is the lowest-information market signal, and evidence is never counted twice.** Accumulation is the default state of a growing market, so `building` contributes near-nothing to the score when `tension`, `beforePrice`, `unusual`, `concentration`, `reversing`, or `nonresponse` already explains the same event. The vector may show several non-zero signals — the *score* must attribute each piece of underlying evidence once. Concretely: `building` enters as a residual after the higher-information signals have taken their share, never as an independent additive term.

Ranking touches, both subtractive:
1. `significance.ts` — `informationGain` becomes a `compose()` part on the derived path. No migration; emitted scores untouched.
2. `feed-cadence.ts` — `primary`/`tensionKind` added to `MixCandidate` for **variety only** (consecutive-run caps, small target bonus when tension is absent from a window). `breakingAt` stays on significance alone.

## 6. Three voice levels; scarcity is a cost, never a ceiling

| Level | When | Shape |
| --- | --- | --- |
| **Receipt** | no tension, low gain | "Alex pulled $15 from YES." |
| **Observation** | single-signal, real change | "YES is thinning out. Three holders left today." |
| **Intelligence** | tension, nonresponse, or high unusualness | "The people stayed. The money didn't. Nine joined. $85 left." |

Budgeting is **soft**: a window target of roughly 20–30% Intelligence, enforced as an escalating repetition cost through the existing motif/diversity machinery — not a hard cap. A genuinely chaotic hour with six real contradictions must be allowed to report six; downgrading true clues to satisfy a quota makes the PI deliberately dumber. Very high `informationGain` bypasses the cost entirely. Same philosophy already used elsewhere in the mixer: penalties, not filters.

Copy rules: the contrast fact comes last and the sentence stops there. No explanation, no motive, no reaction-only headlines ("ODD ONE", "WELL WELL WELL") unless a specific contrast immediately follows. Existing hype-word ban stays.

**The PI does not editorialize when it has nothing to add.** If the Intelligence layer neither compresses nor connects information, the row stays a Receipt. "Alex pulled $15 from YES." must never become "ALEX MADE A MOVE / Alex pulled $15." Style is not insight.

## 7. Personal relevance modifies the angle, after ranking

Two distinct jobs, deliberately separated:

- **Admission and rank** — market signal (viewer-blind) plus the existing personal axis. `viewerBoost` stays out of the vector computation.
- **Angle selection** — once a row is admitted, the editorial choice of *which fact to foreground* may see relationship context. "Three people entered NO" becomes "Your Rival was one of them." The market facts are identical; only the foregrounded one changes.

Invariant: personal context can change the selected angle, never the underlying market signal or the vector.

## 8. Confirmation is gated — a trust invariant

**If the PI cannot establish ordering, the PI cannot tell a before/after story.** Event timestamp + 24h change ≠ change since the event; the window can predate the entry.

`confirmation` is computed but emits nothing until temporal order is provable from price observations (a bounded `price_snapshots` / `market_state_snapshots` read for just the markets with a candidate build event in-batch). The bare conjunction — "$244 entered YES today. YES is also up 11% over 24h." — is factually safe but psychologically implies causation, so it is also withheld until temporal resolution makes it genuinely useful. One suspicious inference and the feed stops being believed.

## 9. Clue lifecycle (product principle; phase 1 supports only the first)

A PI is valuable because they remember. The eventual arc:

```text
10:00  new clue        Three wallets stepped into an empty YES. Price hasn't moved.
13:00  developing clue Still quiet. Same three wallets. Price basically unchanged.
16:00  resolved clue   Now it's moving. YES is up 9%.
```

The distinction `new | developing | resolved` is written into the model now even though phase 1 emits only `new`. `buildTape` already holds the 72h batch keyed by `(marketId, side, occurredAt, sourceKey)` and `feed-editorial.collapseCausal` already correlates that pair within 6h to *suppress*; the same index will *connect*. Caveat kept honest: the batch is `limit*3` events across all markets, so an older clue can fall out of the window — absent link, the row behaves exactly as today. No fabrication, no new table.

## 10. Missing data

- **Intraday price path** — blocks resolved clues and any before/after phrasing (§8).
- **Cross-poll memory** — no record of what a reader already saw; a developing clue can restate itself between polls. Motif pruning limits it within a window; if it annoys, fix client-side, not with a table.

## 11. Smallest safe sequence

1. Widen the `market_state` select in `loadTapeSource` to §2 columns; extend `Momentum`. Behaviour-neutral.
2. **2a.** Audit concentration + nonresponse derivability against current reads (§2) before anything depends on them.
3. Add `src/domain/signal-vector.ts` + tests. Pure, unused at first.
4. Attach the vector to rows in `buildTape`; review in the dev voice lab (`/dev/voice`) with nothing wired to ranking.
5. Wire `informationGain` into the derived branch of `significance.ts`.
6. Voice levels in `pi-voice.ts` + soft Intelligence cost with exceptional bypass in the cadence pass.
7. Viewer-relative angle selection, post-admission.
8. Variety caps on `primary`/`tensionKind` in `feed-cadence.ts`.
9. Confirmation and developing clues only after §8's temporal proof exists.

## 12. Tests and invariants

Storytelling invariants first — the numbers exist to serve them:

- **Viewer-blindness:** two different viewers looking at the same market facts get the **identical** SignalVector. They may get different reasons to care.
- A larger ordinary trade does **not** always outrank a smaller market-relative anomaly.
- Two individually ordinary facts become high information gain when their *relationship* is unusual.
- Personal relevance can change the selected angle, never the underlying market signal.
- **No editorial layer without informational value:** a fact with nothing added stays a Receipt ("Alex pulled $15 from YES." never becomes a headline restating itself).
- **Anomaly cannot manufacture structural significance:** a high-unusualness small event never outranks a majority flip.
- A high-information story bypasses editorial scarcity.
- No PI observation states an expectation the data model did not encode (no "should have", no "expected").
- No copy contains "caused", "because", "drove", "sent", or "since then" while §8 is ungated.

Plus the numerical ones:

- Signals are independent: people↑ / capital flat / price flat / 6× normal pace yields non-zero `building`, `beforePrice` and `unusual` simultaneously.
- Social/personal kinds return an all-zero vector, asserted per kind — while their existing significance behaviour is unchanged (a Twin discovery still reaches the exceptional band).
- `nonresponse` fires only after the input threshold *and* the N-hour window, and at most once per underlying input **per build/editorial window**; cross-poll repetition is a known, accepted phase-1 limitation.
- `beforePrice` requires input above the materiality threshold and price inside the quiet band — not `priceChange === 0`.
- Concentration: five small arrivals plus one large exit classifies as `newcomers_replaced_a_whale` — but only if §2's audit proved the pre-event hierarchy is reconstructable; otherwise the kind is not emitted at all.
- Regression: full suite green; existing `feed-cadence` breaking-band and dominance tests unchanged; `buildTape` output unchanged after step 1.

## Technical notes

Files: `src/lib/live.functions.ts`, new `src/domain/signal-vector.ts` (+ test), `src/domain/significance.ts`, `src/domain/feed-editorial.ts`, `src/domain/feed-cadence.ts`, `src/domain/pi-voice.ts`. No migrations, no new tables, no cron, no second scoring engine; `src/domain/feed/*` untouched.
