# The Insider — the intelligence domain layer

> **The constitutional rule**
>
> **No product surface calculates market intelligence.** Facts are produced by the
> canonical data systems (`events`, `wallet_beliefs`, `market_state`). **The
> Insider** interprets those facts. Product surfaces only **filter, aggregate,
> personalize, and render** Insider output.

This is the design principle for every future feature. It is also encoded as
`INSIDER_CONSTITUTION` in `src/domain/insider/index.ts` so docs, tests, and future
architecture checks cite the same words. The contract invariants — the
constitutional rule, builder replay-determinism + provenance, activity
scope/side/order parity, and bounded plural scoring — are guarded in CI by
`npm run check:insider` (`scripts/check-insider.ts`), alongside the repo's other
`check:*` gates.

## The principle

The underlying **data** architecture is already sound. Fragmentation happens
*after* the facts are created: different product surfaces independently interpret,
rank, narrate, and react to those facts. The Insider is the missing layer the code
has been moving toward without naming it.

```text
WHAT HAPPENED                                  (canonical facts — not this layer)
events + wallet_beliefs + market_state
          │
          ▼
╔══════════════════════════════════╗
║           THE INSIDER            ║
║  observe → calculate → detect    ║
║  score → explain → personalize   ║
╚══════════════════════════════════╝
          │
          ▼
     INSIDER SIGNALS
          │
   ┌──────┼────────┬───────────┐
   ▼      ▼        ▼           ▼
Insider  Insider  Insider    Insider
Activity Insight  Now        Read
```

**One intelligence system. Four projections.** Not four intelligence systems that
happen to use some of the same data.

- **Insider Activity** — what just happened.
- **Insider Insight** — what it means.
- **Insider Now** — what deserves your attention.
- **Insider Read** — what we think it means for you.

## The Insider owns meaning, not facts

Canonical (answers *what is true?*): `events`, `wallet_beliefs`, `market_state`.
These keep their ownership exactly as documented in `data-ownership.md` /
`data-flow.md` and are **not** rewritten.

Insider (answers *what is interesting about what is true?*): `signals`, `pulse`,
`stories`, `read`. A trade is an **event**. "YES momentum is accelerating" is an
Insider **signal**. "We think you'll vote YES" is an Insider **read**. Keeping
this boundary is what stops editorial / prediction logic from contaminating
canonical history.

Not every derived thing becomes another `event`. Derived *interpretations* are
Insider signals; only genuine facts (a side flip, a position becoming directional)
are canonical `events` — see the `source='system'` transition kinds in
`data-flow.md` §4.

## One vocabulary, not one score

The concepts already exist — significance, feed score, discovery value, cadence,
signal vectors, market vitality, opportunity score, House Read confidence,
relationship boost, stake boost. The problem was never that they are bad; it is
that they **don't roll up into a common model**. `src/domain/insider/types.ts` is
that model: `InsiderSignal`, `InsiderEvidence`, `InsiderPulse`, `InsiderInsight`,
`InsiderStory`, `InsiderRead`, `InsiderMarket`, `InsiderNow`.

**Calculate the evidence once; interpret it differently per surface.** There is
deliberately **no single `insiderScore`**. Collapse every question into one number
and the product eventually gets stupid. Instead the universal evidence
(`freshness, velocity, magnitude, capitalFlow, participation, imbalance, novelty,
relationship, stake, confidence`) is computed once, and each surface answers a
different question from it:

| Projection | Question | Emphasizes |
|---|---|---|
| **Activity** | What just happened? | freshness + market + side; almost no editorializing |
| **Insight** | What does all of this mean? | momentum, direction, acceleration, participation, capital flow, imbalance, unusualness |
| **Now** | What is worth interrupting me with? | importance + novelty + magnitude + acceleration + corroboration + freshness + personal relevance |
| **Read** | What do we think YOU will do? | market evidence + viewer DNA + history + relationships + existing position + confidence |

## One resource — logically, not one giant payload

The **single-resource principle** is a single domain **contract**, not one giant
object every screen downloads. `InsiderMarket` is the per-market resource;
`InsiderNow` is the global feed resource. They are **separate cache scopes**: the
global evidence stays highly cacheable and side-blind, and the viewer overlay
(`read`, `personalRelevance`) is layered on afterward. Same computation system,
different projections.

---

## Surface inventory — every place we present information

> This is the "did we miss any surfaces?" review. The original four-projection
> sketch covers the in-app market **detail** and the global **feed**. The system
> presents Insider-derived information on **more** surfaces than that — notably
> external/share, embeds, the grid, the pre-auth landing, people/DNA, and
> creation-time. The unification must account for all of them. ✅ = a projection
> already fits; ⚠️ = a surface the four-projection sketch under-counts.

### In-app, market detail (center)

| Surface | File | Presents | Projection |
|---|---|---|---|
| Market Momentum | `components/MarketVitality.tsx` | "how big / which way" | **Insight / Pulse** ✅ |
| The House Read | `components/HouseRead.tsx`, `domain/house-read.ts` | prediction of your next move | **Read** ✅ |
| Case File | `components/CaseFile.tsx` | shape/history + **"Insider Moves"** side rail | **Activity + Insight** ✅ |
| Market Insider | `components/CurrentMarketActivity.tsx` | market-scoped activity | **Activity** ✅ |
| Why This | `components/WhyThis.tsx` | why this market is in front of you | **Now / Read** (personal relevance) ✅ |
| Order / Examine | `components/order/ExamineRail.tsx`, `StandOnIt.tsx`, `PutOnTable.tsx` | the docked read at the decision | **Read** ✅ |
| Deck / Scene | `components/MarketDeck.tsx`, `MarketScene.tsx` | the market container | host of the above |

### In-app, the feed & rails (right)

| Surface | File | Presents | Projection |
|---|---|---|---|
| Insider feed | `components/LiveTape.tsx`, `lib/live.functions.ts` | the newsroom | **Now** ✅ |
| Challenge \| Insider | `components/ChallengeRail.tsx` | the two social questions | hosts **Now** ✅ |
| Ideas / Launch | `components/IdeasRail.tsx`, `LaunchRail.tsx`, `hooks/useHouseIdea.ts` | creation-time suggestions | **Read/Insight, pre-market** ⚠️ |

### In-app, the grid & discovery (left/center list)

| Surface | File | Presents | Projection |
|---|---|---|---|
| Market cards + pulse strips | `components/MarketCard.tsx`, `lib/markets.functions.ts` (`listMarketPulses`) | per-card mini activity/pulse | **Activity + Insight, per-card** ⚠️ |
| Grid / worlds | `routes/index.tsx`, `components/MyConvictions.tsx`, `MyWorld.tsx` | ordered market set (`opportunity_score`) | **Insight ranking** ⚠️ |
| Similar / suggested | `components/SimilarMarkets.tsx`, `SuggestedMarketCard.tsx` | recommendations | **Read** (relevance) ⚠️ |
| Explore / lens / window | `components/ExploreSelector.tsx`, `WindowFilter.tsx`, `LensChart.tsx` | filtering/lensing of market info | filters over **Insight** ✅ |

### In-app, people & self

| Surface | File | Presents | Projection |
|---|---|---|---|
| People / network | `components/PersonProfile.tsx`, `PersonStack.tsx`, `NetworkPanel.tsx`, `ParticipantSheet.tsx` | relationship intelligence | **Read inputs / relationship** ⚠️ |
| Your DNA / dashboard | `components/ConvictionDashboard.tsx`, `DnaOverview.tsx`, `ConvictionReveal.tsx` | your own conviction history | **Read inputs** ⚠️ |
| Shared / connection | `components/SharedConviction.tsx`, `WhatConnectsYou.tsx` | relationship narratives | **Read** ⚠️ |
| Story rendering | `components/StoryStrip.tsx` | story cards | renders **Now/Insight** ✅ |

### Mobile

| Surface | File | Presents | Projection |
|---|---|---|---|
| Mobile game / case | `components/MobileGame.tsx`, `MobileCase.tsx` | market + **"Insider Moves"** | **Activity + Read** ✅ |

### External / non-obvious (the easily-missed ones) ⚠️

| Surface | File | Presents | Projection |
|---|---|---|---|
| OG / share images | `routes/og/market.$mid.ts`, `domain/market-og.ts`, `components/ShareImpact.tsx` | market intelligence **outside** the app (social previews) | **Insight/Now snapshot** ⚠️ |
| Embeds | `lib/embed.functions.ts`, `lib/embed.ts`, `components/MediaEmbed.tsx` | embedded market widgets on external sites | **Insight/Activity** ⚠️ |
| SEO / sitemap / titles | `routes/sitemap[.]xml.ts`, `lib/market-titles.server.ts` | market info for search engines | **Insight snapshot** ⚠️ |
| Pre-auth landing | `components/LandingExample.tsx`, `LandingPanel.tsx` | example market intelligence, signed-out | demo of **all four** ⚠️ |
| How it works | `routes/how.tsx` | describes the surfaces | documentation of the above |

**The takeaway:** the four projections are correct, but "surface" must include the
**external** presentations (OG/share, embeds, SEO), the **per-card** grid
projection, the **pre-auth** landing demo, and the **people/DNA** surfaces that
feed and mirror the Read. These are the same Insider output at a different cache
scope / rendering — not new intelligence systems, and must not become new ones.

---

## Current-state mapping (grounded in current `main`)

Where each Insider job lives **today**. These become **primitives used by the
Insider** rather than independent product engines; ownership changes, not
necessarily the code.

| Insider concept | Current module(s) |
|---|---|
| `InsiderSignal` / evidence | `domain/signal-vector.ts` (`SignalVector`, `SignalFacts`, `Signals`), `domain/signal-facts.ts` |
| importance / significance | `domain/significance.ts` |
| novelty / discovery | `domain/discovery.ts`, `domain/discovery-moment.ts` |
| momentum / acceleration | `domain/feed/momentum.ts`, `domain/feed/score.ts` |
| pulse / direction | `domain/market-pulse.ts`, `domain/market-book.ts`, `lib/market-vitals.ts` |
| opportunity ranking | `domain/opportunity.ts`, `lib/opportunity-feed.functions.ts` |
| stories / standing intel | `domain/standing-story.ts`, `domain/standing-fact.ts`, `lib/standing-facts.server.ts` |
| narrative voice | `domain/pi-voice.ts`, `domain/pi-question.ts`, `domain/composed-clue.ts` |
| feed editorial / cadence | `domain/feed-editorial.ts`, `domain/feed-density.ts`, `domain/feed-cadence.ts`, `domain/feed-scheduler.ts` |
| viewer overlay | `domain/viewer-relationship.ts`, `domain/viewer-stake.ts`, `domain/person-pattern.ts` |
| the read | `domain/house-read.ts` (+ `lib/house.functions.ts`) |
| surface-ready rows | `lib/live.functions.ts` (the current center of gravity — reads canonical events, joins momentum, detects significance/patterns, applies viewer overlay, composes PI narrative, returns rows) |

**Foundation (do not rewrite):** `events`, `wallet_beliefs`, `market_state`, the
position reducer/rebuilder, `lib/events.functions.ts`, and the single realtime
coordinator (`lib/realtime/coordinator.ts`).

> **The old `docs/compatibility-removal.md` ledger is stale.** Verified against
> current `main`: `components/ConvictionFeed.tsx`, `lib/feed.functions.ts`,
> `lib/conviction-feed.ts`, and `lib/feed-copy.ts` **no longer exist**. Do deletion
> based on references in **current `main`**, not the old ledger.

---

## Migration plan (incremental — no big-bang rewrite)

Build the Insider **underneath** the existing UI; migrate one projection at a time
behind an unchanged surface, each step proven by parity tests.

0. **Contract + renames — ✅ landed.** `src/domain/insider/` defines the vocabulary
   (`InsiderSignal`, `InsiderPulse`, `InsiderRead`, `InsiderMarket`, `InsiderNow`,
   …) + the constitutional rule. Types only, non-breaking.
1. **The builder (activity seam) — ✅ landed.** `signals.ts` `signalsFromActivityRows`
   lifts grouped canonical activity (the pure `groupLiveRows` output) into
   `InsiderSignal`s with provenance + `INSIDER_BUILDER_VERSION`. Pure and
   deterministic; replay tests prove identical rows → identical signals. (The
   evidence-scoring seams — magnitude, velocity, novelty — arrive with Insight/Now;
   activity leaves evidence uncomputed, `null` ≠ `0`.)
2. **Activity projection — ✅ landed; rails adopted.** `projections/activity.ts`
   `activity(signals, { marketId, side })` is the one chronological filter, proven
   to reproduce today's server semantics (market scope; `eq(side)` excludes
   market-wide rows from a side column; newest-first + id tiebreak). Wired into the
   **Market Insider** rail (`CurrentMarketActivity`) and now the **YES/NO side
   rails**: a side `LiveTape` no longer asks the server a side-scoped question — it
   shares the market-scoped query (same React Query key as the Market Insider rail)
   and projects its side client-side. Verified in the app on market 2776: both rails
   render the same rows as before and opening the Case File issues ZERO extra
   requests.

3. **Insight/Pulse — ✅ pure seam landed.** `pulse.ts` `insiderPulse` computes one
   `InsiderPulse` (direction, momentum, acceleration, activity, participation,
   capital flow, imbalance, volatility, novelty) by COMPOSING the existing
   primitives — one definition of each: shape ← `pulseLabel`, "normal" ←
   `unusualness`/`dailyBaseline`, price move ← `relativeMove`.
   `projections/insight.ts` `insight(pulse)` is the calm human sentence. Pure +
   tested. **UI adoption** (`MarketVitality` "Market Momentum" → Insider Insight)
   changes the rendered read, so it lands with an app run — same discipline as the
   side-rail flip.
4. **Now onto the Insider — 🚧 in progress; the render-boundary pass has landed.**
   `projections/now.ts` `now(rows, { limit, rankOver, pinned, pending, loading })`
   now owns the EDITORIAL DECISION the tape used to make inline: rank the
   candidates (`mixFeed`), select the window by that rank, display in the reader's
   temporal model (`arrangeFeed`), and name the tail state (`tailState`). `LiveTape`
   keeps only attention mechanics — the update gate, the arrival scheduler, scroll.
   Parity by construction (same primitives, same order) and proven by
   `projections/now.test.ts` plus an app run: continuity block on top, then
    15m → 51m → 2h → 3h → … unchanged. **Source pass landed:** every way the tape
    touches the world now lives in `src/lib/insider/source.server.ts`
    (`loadTapeSource`, `loadBelieverFaces`, `loadActorBeliefs`, `loadViewerDna`,
    `loadViewerHoldings`, `loadPricePaths`, `TapeDeps`/`REAL_DEPS`), with the query
    shape in `insider/tape-input.ts` — each loader declared GLOBAL or VIEWER at its
    signature, which is what the shared-tape cache key rests on. **Discovery pass
    landed:** `insider/composition/discovery-pass.ts` `runDiscoveryPass(...)` owns
    the second ranking dimension (discovery scores + the synthesized "you two
    should meet" rows) as one pure function — no IO, no input mutation, so two
    readers can be run over the same facts and compared. **Significance pass
    landed:** `insider/composition/significance-pass.ts` owns the first ranking
    dimension in two pure halves — `buildCandidates(...)` (one candidate per row,
    read by the gate, the score and the batch bar) and `runSignificancePass(...)`
    (adaptive floor, heartbeat bar, anomaly vectors, admission, tier, derived
    score, and the rejected-but-evidential rows). The one bounded read it needs,
    `loadPricePaths`, stays in the source layer and runs between the halves.
    **Still to pull in:** grouping and PI narrative drafting out of
    `live.functions` into `src/lib/insider/*` behind the same projection.

5. **Read — ✅ pure seam landed.** `read.ts` `insiderRead(source, { pulse })` lifts
   the pure house-read state machine into `InsiderRead` unchanged (learning →
   predicted → correct/incorrect), and adds the additive `marketAligned` context
   (does the market's `InsiderPulse` agree with the side we think you'll back?),
   which NEVER changes the prediction — the seam through which the read gets richer
   over time. **UI adoption** (the House Read surface → "Insider Read", including
   the visible label) changes rendering, so it lands with an app run.
6. **Collapse realtime around the Insider.** Keep the one-socket architecture; as
   consumers converge, surface-specific cache families give way to
   `["insider", marketId]` and `["insider","now"]`.
7. **Reference audit + delete.** Remove old plumbing with zero remaining imports in
   current `main`; update `data-flow.md`, `data-ownership.md`, this file, and the
   architecture checks to enforce the boundary.

### Proposed code organization (target)

```text
src/domain/insider/
    types.ts        # the contract                         ✅ landed
    index.ts        # barrel + INSIDER_CONSTITUTION         ✅ landed
    signals.ts      # canonical activity → InsiderSignal[]  ✅ landed (activity seam)
    pulse.ts        # market facts → InsiderPulse           ✅ landed
    read.ts         # house-read, lifted into InsiderRead   ✅ landed
    features.ts     # universal evidence (calculate once)   ✅ landed
    scoring.ts      # evidence → momentum/importance/confidence  ✅ landed
    projections/
        activity.ts  # ✅ landed   insight.ts  # ✅ landed   now.ts  — needs app run

src/lib/insider/
    source.server.ts   build.server.ts   functions.ts   cache.ts       — next
```

---

## Renames applied in this pass

| Before | After | Where |
|---|---|---|
| "Now" (feed tab/heading, prop, aria, comments) | **Insider** | `ChallengeRail.tsx`, `index.tsx`, `LiveTape.tsx`, `dev.rail.tsx` |
| "In this market" | **Market Insider** | `CurrentMarketActivity.tsx` (+ `dev.rail.tsx`) |
| "Recent activity" | **Insider Moves** | `CaseFile.tsx`, `MobileGame.tsx` |

The visible feed tab already read "Insider"; this pass completed the rename through
the internal tab id, the `insider` prop, the `aria-label`, and the trailing
comments so nothing still calls it "Now".
