# Live feed — the rule set

Seven stages stand between a chain event and a row on screen. Each asks a different question, and an
event has to survive all of them. Nothing here invents activity: every gate can only remove, delay,
or re-describe something that actually happened.

Thresholds live in the exported config object named in each section — change them there, never at a
call site. **This file documents the code; the code is the truth.** If they disagree, the code wins
and this file is stale.

Every constant carries a provenance mark, because they are not equally trustworthy:

| Mark  | Meaning                                                                             |
| ----- | ----------------------------------------------------------------------------------- |
| **M** | Measured against production data. Changing it should mean re-measuring.             |
| **C** | Calibrated against a scoring range or a structural minimum — derived, not observed. |
| **A** | Assumed. A plausible number nobody has validated against a real feed yet.           |

---

## 1. Ingest — what is even eligible

`src/lib/live.functions.ts`

The feed reads the canonical `events` log directly. There is no second pipeline and no feed-specific
table: every row a reader sees traces to one durable event.

- **Seven kinds only** — `trade`, `market_created`, `position_changed_side`, `believer_milestone`,
  `tribe_doubled`, `market_transition`, `conviction_cohort`.
- **Canonical only.** Reorg-orphaned events are excluded at the query, never filtered later.
- **Over-read then group.** Three times the requested limit is fetched, because grouping collapses
  rows and the target is rows-_after_-grouping.
- **Realtime first.** A websocket on trade inserts (`src/lib/realtime/coordinator.ts`) drives
  freshness; the 30s poll is only a reconnect floor.

| Constant                | Value  |     | Governs                                                                                                      |
| ----------------------- | ------ | --- | ------------------------------------------------------------------------------------------------------------ |
| `LIVE_WINDOW_MS`        | 72 h   | C   | How far back "live" reaches. Older is history.                                                               |
| `limit` (default)       | 120    | A   | Rows requested                                                                                               |
| over-read multiplier    | ×3     | C   | Fetched before grouping                                                                                      |
| `refetchInterval`       | 30 s   | C   | Reconcile poll, not the freshness path                                                                       |
| `LIVE_DELTA_OVERLAP_MS` | 16 min | C   | Delta re-fetch window. **Must exceed every grouping window below** or the cached tail stops being immutable. |
| `MAX_DELTA_SPAN_MS`     | 30 min | A   | Beyond this, full fetch instead of delta                                                                     |

---

## 2. Group — many events, one thing that happened

`src/lib/live-tape.ts` · `groupLiveRows`

Four groupings in priority order. **This is where repetition is handled** — not in ranking, and not
by hiding rows downstream.

- **Churn is dropped entirely.** Six or more trades on one (market, side) within two hours whose buy
  and sell volumes balance within 10% went nowhere. Measured: three wallets produce over half this
  platform's trades this way.
- **Washes are dropped.** A buy matched to a sell of the same size within fifteen minutes changed
  nothing. Volume is not conviction.
- **Sweeps become one row.** One wallet across three or more markets within an hour is coordination,
  and coordination is one story.
- **Bursts collapse** by (market, side, action), clustered by time rather than by list position.

| Constant                 | Value  |     | Governs                                 |
| ------------------------ | ------ | --- | --------------------------------------- |
| `GROUP_WINDOW_MS`        | 10 min | C   | Burst clustering                        |
| `ROUND_TRIP_WINDOW_MS`   | 15 min | C   | Wash detection                          |
| `ROUND_TRIP_TOLERANCE`   | 2 %    | C   | Size match that still reads as a wash   |
| `CHURN.minTrades`        | 6      | M   | Three full cycles                       |
| `CHURN.windowMs`         | 2 h    | M   | Churn detection window                  |
| `CHURN.balanceTolerance` | 0.10   | M   | How closely buy and sell must match     |
| `SWEEP_WINDOW_MS`        | 60 min | C   | Cross-market sweep                      |
| `SWEEP_MIN_MARKETS`      | 3      | C   | Markets before it reads as coordination |

**The metrics agree with the feed.** The verdict is recorded once on `events.is_wash` by a marker job
(`src/lib/wash-marker.server.ts`) and read by both — the rule itself lives in
`src/domain/wash-trading.ts` and is never re-implemented in SQL. A market whose volume spikes on the
scoreboard while its tape stays silent makes a reader distrust both numbers, so `market_event_windows`
excludes flagged trades from every count, volume and unique-wallet figure.

> **Still outstanding.** `market_state.volume_total_usd` is POV-owned (an external figure we store,
> not one we compute), so it remains unfiltered. Everything derived from our own event log is clean.

---

## 3. Admit — is this big enough to say?

`src/domain/feed-event.ts` · `src/domain/feed-density.ts`

Importance is scored from three terms, then converted to a tier. The absolute gate admits tiers 1–3.
A second, adaptive gate then decides whether the bar should come down.

**Score** = magnitude 50% + novelty 30% + speed 20%, multiplied by relevance to the reader.

**Tiers** (`tierOf`, evaluated in order):

| Tier | Condition                                                            |
| ---- | -------------------------------------------------------------------- |
| 4    | `round_trip` — a wash says nothing                                   |
| 1    | structural news, **or** a Twin/Rival acting, **or** score ≥ 75       |
| 2    | score ≥ 45, **or** a network cluster (≥2 wallets), **or** structural |
| 3    | any relationship, **or** score ≥ 25                                  |
| 4    | everything else — texture, does not enter                            |

**The bar adapts to the day.** The floor is the score of the Nth-best candidate in the batch, clamped
between `hardFloor` and `standard`. On a busy day this changes nothing; on a quiet one the small true
things get to speak. The floor **only ever relaxes** — it can never rise above the standard bar, so
this can add rows and never remove them.

Two things never come back, however dead the day:

- **Washes.** The clearest case of volume being confused with conviction.
- **Dust** under `dustUsd` — but only on the _relaxed_ path. A Twin's $3 buy that earned Tier 3 on its
  own merits is the product working, not noise.

| Constant                          | Value           |     | Governs                                                                                                                                                                              |
| --------------------------------- | --------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CORE_WEIGHTS`                    | 0.5 / 0.3 / 0.2 | C   | magnitude · novelty · speed                                                                                                                                                          |
| `ABS_USD_CAP`                     | $2,000          | A   | Absolutely "big" regardless of market                                                                                                                                                |
| `PER_BELIEVER_USD`                | $8              | A   | Market-relative reference stake                                                                                                                                                      |
| `DENSITY.target`                  | 14              | A   | Rows before a feed reads as inhabited                                                                                                                                                |
| `DENSITY.standard`                | 25              | C   | The normal bar (Tier-3 boundary)                                                                                                                                                     |
| `DENSITY.hardFloor`               | 15              | C   | Floor's floor. The people term plus novelty put a structural minimum of ~14 under _every_ lone trade, so a score threshold alone cannot tell $0.20 from $70 — that job is `dustUsd`. |
| `DENSITY.dustUsd`                 | $0.50           | M   | Was $5 until real prices showed trades at $0.02–$2.46                                                                                                                                |
| `FEED_TRIGGERS.price.minPct`      | 8 %             | C   | Price move that is news                                                                                                                                                              |
| `FEED_TRIGGERS.capital.minUsd`    | $25             | C   | Capital move floor                                                                                                                                                                   |
| `FEED_TRIGGERS.believers.minAbs`  | 3               | C   | Believer move floor                                                                                                                                                                  |
| `FEED_TRIGGERS.switch.minWallets` | 2               | C   | Wallets before a side flip is breaking                                                                                                                                               |

---

## 4. Rank — whose story is this?

`src/domain/significance.ts` · `src/domain/discovery.ts` · `src/domain/viewer-relationship.ts`

Two dimensions, deliberately separate. **Significance** says how big an event is. **Discovery** says
whether it opens a relationship. A $5,000 anonymous trade really is the bigger event, and a $50 buy
by your Twin really is the better row.

- **Never rank purely by dollars.** Discovery lifts a candidate's quality toward 1 in proportion to
  how much of an introduction it is.
- **Evidence gates the pull.** Below `minShared` shared beliefs, a relationship claims nothing.
- **Familiarity decays.** After `familiarAfter` appearances in one window, a person stops being a
  discovery.
- **Strangers count.** Someone with real tenure and no relationship is still worth meeting.
- **The reader's own relationships are a bounded read-time boost** — never baked into the stored
  score, because the same event must not have two identities.

| Constant                      | Value                  |     | Governs                                        |
| ----------------------------- | ---------------------- | --- | ---------------------------------------------- |
| `MAX_RELATIONSHIP_BOOST`      | 0.15                   | C   | Ceiling on "who they are to you"               |
| `DISCOVERY.minShared`         | 6                      | C   | Evidence before a relationship pulls           |
| `DISCOVERY.familiarAfter`     | 2                      | A   | Appearances before novelty decays              |
| `DISCOVERY.strangerMinDays`   | 30                     | A   | Tenure that makes a stranger interesting       |
| `DISCOVERY_MOMENT.minShared`  | 8                      | C   | Evidence for a NEW TWIN moment                 |
| `DISCOVERY_MOMENT.maxPerFeed` | 2                      | A   | Rarity is the point — never dilute             |
| `DISCOVERY_MOMENT.tribeRungs` | 5 · 10 · 25 · 50 · 100 | C   | Tribe-growth milestones                        |
| `SIGNIFICANCE.fallback`       | 0.50                   | C   | An unscored kind. Logged in dev, never silent. |

---

## 5. Select — variety, without breaking chronology

`src/domain/feed-cadence.ts` · `mixFeed`

The mixer decides **which** rows survive the window. It does **not** decide the order. Re-ordering
shipped once and was pulled: the column read 3h, 41m, 1h, 2h and felt broken rather than curated. A
live tape's contract is "what just happened, in order".

- **Adjacency is penalised, never filtered.** Repeating a family, market, motif, side or person costs
  score across a three-row lookback, decaying with distance. If the only candidates left are three
  holding milestones, you get three holding milestones rather than an empty feed.
- **Nobody dominates.** Soft caps per wallet and per market apply as growing penalties, so a busy
  market is quietened rather than silenced.
- **Breaking news skips the queue.** Above `breakingAt`, no adjacency, no dominance, no pacing.

**This stage is inert below 40 rows** (`LiveTape.tsx` gates on `VISIBLE_ROWS`). At current volume the
feed is always below that, so every candidate is shown — selection cannot create variety when nothing
is being deselected. If the feed reads repetitive on a quiet day, this is not the lever.

| Constant                        | Value                       |     | Governs                                                                                          |
| ------------------------------- | --------------------------- | --- | ------------------------------------------------------------------------------------------------ |
| `lookback`                      | 3                           | A   | How far back adjacency is felt                                                                   |
| `penalty.motif`                 | 0.30                        | A   | Same sentence shape — penalised hardest, because phrasing is what reads as robotic               |
| `penalty.subject`               | 0.22                        | A   | Same person                                                                                      |
| `penalty.family`                | 0.18                        | A   | Same event type                                                                                  |
| `penalty.market`                | 0.14                        | A   | Same market                                                                                      |
| `penalty.side`                  | 0.05                        | A   | Same side                                                                                        |
| `maxPerWallet` / `maxPerMarket` | 2 / 3                       | A   | Soft dominance caps                                                                              |
| `penalty.overCap`               | 0.35                        | A   | Cost per row over a cap                                                                          |
| `breakingAt`                    | 0.80                        | C   | Skips sequencing entirely                                                                        |
| `minQuality`                    | 0.25                        | C   | Below this, never promoted to fill a family target                                               |
| `newPersonBonus`                | 0.10                        | A   | Someone not yet met this window                                                                  |
| `discoveryLift`                 | 0.85                        | C   | How far discovery can lift quality                                                               |
| `FAMILY_TARGET`                 | 47.5 / 18 / 15 / 12 / 7.5 % | A   | live_action · conviction_celebration · market_transition · collective_story · relationship_story |

---

## 6. Pace — when the reader actually sees it

`src/domain/feed-scheduler.ts` · `src/hooks/useScheduledRows.ts`

Rendering a whole poll response into one React frame is a page refresh wearing a transition. The
scheduler releases **one row at a time** and decides which goes next.

**The rule: real activity interrupts, standing facts fill silence.**

**Two axes, not three lanes.** Perishability picks _when_; weight picks _how_. Collapsing them trips
over its own edge — a NEW TWIN discovery is the most _important_ row the product has and among the
least _urgent_, because it is equally true forty seconds later.

| Perishability | Applies to                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `now`         | Coordinated buying/selling, market creation, the viewer's own action, structural transitions. Never intentionally held. |
| `soon`        | Ordinary trades, price moves, network activity, discovery moments. Released in sequence; never held past `maxHoldMs`.   |
| `standing`    | Duration facts. No "when" at all. Drawn only during genuine silence.                                                    |

- **Preemption is by weight, not by lane.** "A celebration must never delay a trade" taken literally
  lets a $2 dust trade preempt a discovery moment — importance losing to recency. Priority is
  `perishRank × 3 + (weight − 1)`, so the heaviest paced row ties the lightest immediate one.
- **Backpressure is collapse, not speed.** Below the animation floor a staggered entrance is
  indistinguishable from a reload. Volume is answered by one row saying seven.
- **Pacing is anticipatory**, derived from what it takes to drain the paced queue before its oldest
  member breaches its bound. A reactive version spends its slack early and stays permanently behind.
- **The first paint is not a stream.** Everything on screen at mount shows at once. Switching market
  resets the scheduler — that is a new page, not a stream arriving.

| Constant       | Value                   |     | Governs                                                                                                                                                                  |
| -------------- | ----------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `minGapMs`     | 700 ms                  | C   | Animation floor. Even a `now` row waits this long — that is the floor, not a delay.                                                                                      |
| `busy`         | 1.5 – 3 s               | A   | Four or more real rows queued                                                                                                                                            |
| `normal`       | 3 – 6 s                 | A   | The ordinary rhythm                                                                                                                                                      |
| `quiet`        | 15 – 30 s               | A   | One standing fact, unhurried                                                                                                                                             |
| `busyDepth`    | 4                       | A   | Queue depth that tightens the cadence                                                                                                                                    |
| `quietAfterMs` | 45 s                    | A   | **Product decision hiding in a constant.** At current volume the feed is in quiet mode nearly always, which makes standing facts the primary content rather than filler. |
| `maxHoldMs`    | 15 s                    | C   | Longest a paced row may be held                                                                                                                                          |
| `floorHoldMs`  | 1400 / 900 / 700 / 0 ms | A   | Beat held after a tier 1–4 row                                                                                                                                           |
| `collapseMin`  | 3                       | C   | Rows sharing a key that merge                                                                                                                                            |
| `memory`       | 400                     | C   | Released ids remembered for dedup                                                                                                                                        |

---

## 7. Render — motion carries meaning

`src/components/LiveTape.tsx` · `src/styles.css`

The tier that decided whether a row was worth showing now decides how much it is allowed to move.
Motion that is identical everywhere tells a reader nothing.

| Tier | Entrance                                                                               |
| ---- | -------------------------------------------------------------------------------------- |
| 1    | `tape-enter-major` — 420 ms, and the scheduler holds the floor so it gets a beat alone |
| 2    | `tape-flash` — 220 ms slide plus a relationship-colour wash                            |
| 3    | `tape-enter` — 220 ms slide                                                            |
| 4    | none. It appears.                                                                      |

- **Colour discipline.** The only tinted glyphs are the words YES / NO and signed percentages.
  Everything else stays neutral, so the eye is not asked to decode a wall of red and green.
- **Timeless rows show no timestamp.** A standing fact has no "when"; printing an age beside it would
  read as "this just happened".
- **Reduced motion collapses every animation to nothing** — not to a slower version of itself.

---

## Parallel track — standing facts

`src/domain/standing-fact.ts` · `src/lib/standing-facts.server.ts`

Every stage above reports a **change**. At roughly one trade every eleven minutes, a feed built only
from events is silent most of the time. A standing fact reports a **continuity** instead: who is
still here.

No table and no emitter — these are positions the database already knows about, read at request time
and returned in a separate `standing` array. They bypass the mixer, never show on first paint, and
carry no `occurredAt`. Built on full fetches only; a delta poll carries the previous reserve forward.

**They do not expire.** Treating them as events with a maximum age manufactures the staleness it then
has to manage, and a queue of celebrations drains to empty — the dead feed this exists to prevent.
The control is a per-reader **cooldown**, held in `localStorage` and recorded on _release_ rather
than on fetch, so a fact that was held and never drawn stays available.

**Ranking leads with recognition, not size.** A Twin's $20 position outranks a stranger's $50,000
one. That is the opposite of what a significance score says and the right answer to "am I alone here".

| Constant                      | Value     |     | Governs                                     |
| ----------------------------- | --------- | --- | ------------------------------------------- |
| `STANDING.minPositionUsd`     | $5        | C   | Dust earns no face and no mention           |
| `STANDING.minDays`            | 3         | A   | Below this, "still here" is not yet a claim |
| `STANDING.maxPeople`          | 3         | C   | Named before the rest become "+N"           |
| `STANDING.cooldownMs`         | 3 days    | A   | Per-reader repeat guard                     |
| `STANDING.minCrossings`       | 3         | A   | Shared markets before it is a pattern       |
| `STANDING_RESERVE`            | 6         | A   | Facts held per full fetch                   |
| `MAX_MARKETS` / `MAX_BELIEFS` | 24 / 1500 | C   | Read bounds on the request path             |

### Conviction cohorts

`src/domain/conviction-cohort.ts` · `src/lib/conviction-cohort-emit.server.ts`

Unlike standing facts these _are_ events, written to the canonical log by the market-refresher cron.
Four gates: the crossing window, one row per (market, side), the `source_key` fingerprint, and a
per-run cap. Plus a one-time catch-up sweep for crossings nobody was watching for.

| Constant                | Value                        |     | Governs                                       |
| ----------------------- | ---------------------------- | --- | --------------------------------------------- |
| `HOLDING_RUNGS`         | 7 · 30 · 60 · 90 · 180 · 365 | C   | Durations people actually think in            |
| `COHORT.minPositionUsd` | $5                           | C   | Dust floor                                    |
| `COHORT.groupMin`       | 2                            | C   | Below this it is an individual, not a cohort  |
| `COHORT.soloMinRung`    | 30 days                      | C   | A lone believer needs longer to earn a row    |
| `COHORT.maxPerRun`      | 12                           | A   | A mass crossing drains; it does not dump      |
| `MIN_SIGNIFICANCE`      | 0.25                         | C   | Quality floor for publishing                  |
| `WINDOW_DAYS`           | 1                            | C   | Crossing window; `source_key` absorbs repeats |

> **Calendar risk.** Milestones are paced by the clock, so markets whose believers arrived together
> cross together. This platform's index begins on one date (see `src/domain/tenure.ts`), which puts
> ~681 markets on the same 30-day anniversary — **2026-08-23**. The per-run cap is what turns that
> from a wall into a drain: ~12 per run over roughly 2.3 hours, inside a 24-hour visibility window.

---

## Invariants

Every threshold above is tunable. These are not. Each exists because it was broken once and cost
something real.

**Never invent activity.** Every row traces to something that happened or a position someone holds.
An empty feed is a fact; padding it is a lie. No shimmer, no fake pulses, no fabricated counts.

**Timestamps come from `occurredAt`, only.** When a row is _released_ is a presentation detail — per
reader, per session, never persisted and never displayed. A row cannot claim to be newer than it is.
A fact with no "when" shows no time at all rather than borrowing one.

**A network member is never shown taking a side.** Someone in the reader's network is shown moving,
never shown moving _which way_. This holds harder for standing facts, which describe a position still
held — so network members are excluded from side-naming facts entirely, rather than filtered at the
sentence.

**Weak data, weak claim.** Every context field is optional and every sentence degrades honestly when
one is missing. A belief predating the index reads "43+ days", never "43 days"
(`src/domain/tenure.ts`). A valuation that fell back to cost basis can never produce a gain
(`src/domain/position-value.ts`).

**Duration is a fact; character is not.** The feed reports how long someone held something. It never
calls them loyal, steadfast, or diamond-handed — those are qualities the data cannot evidence.

**Nothing is withheld permanently.** Every hold in the scheduler is bounded. A row deferred by the cap
returns on the next run. The queue is a presentation detail; the event log is the truth, and it is
never edited to make the feed read better.

---

## Failure modes this pipeline has actually had

Kept because each one was invisible from inside the app, and the shape recurs.

| Symptom                                                                           | Cause                                                                                                     | Guard now in place                                                                                                                                           |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every trade priced $0, feed showed two rows                                       | `calc_cache` RLS: readable by service_role only. PostgREST answers 200 + zero rows.                       | `scripts/check-schema.ts` runs as the **publishable** key — a checker with more access than the thing it checks will certify a broken system                 |
| No tenure in any sentence                                                         | `wallet_beliefs` 401 to anon                                                                              | `serviceClientOrNull()` — a missing key costs the detail, never the page                                                                                     |
| Zero `market_transition` rows, ever                                               | Two migrations written but never applied                                                                  | `check:schema` names the migration per requirement                                                                                                           |
| Zero conviction cohorts, ever                                                     | Emitter scoped to the _dirty_ batch — quiet markets structurally excluded from the feature built for them | Clock-driven scan: "who has an anniversary today", markets follow                                                                                            |
| Weeks of `ok: true` with 0 emitted                                                | Bare `catch {}` in the refresher                                                                          | Errors surfaced in the job's JSON response                                                                                                                   |
| Cohorts, standing facts, whale detection and the dashboard's held count all empty | `wallet_beliefs.yes_value_usd` — six readers, zero writers. `Number(null) === 0`.                         | `src/domain/position-value.ts` returns value **with its source**; `valuation-ownership.test.ts` asserts structurally that no consumer coerces the raw column |
| `market_state_snapshots` at 0 rows while the job reported success                 | Maintenance steps chained: the first threw, the third only `console.error`'d                              | Each step independent, each outcome in the response body                                                                                                     |

The pattern in five of these: **something computes the right answer and throws it away.** The feed
tier was computed to admit a row and discarded. The poller's maintenance outcomes were discarded.
`evaluate()` returned a valuation the writer did not persist. When a feature is silent, check whether
the value is missing or merely dropped.
