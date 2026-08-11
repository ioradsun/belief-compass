# For You: one simple rule, and a feed that never stops

## How it works today

The For You feed already pages through the catalogue, but it decides what you may see with several overlapping rules layered on top of each other:

- Hard blocks: you hold a position, you passed (24h), you passed twice (7d), you sold out (7d), you hid it (forever).
- Soft blocks that come back on a timer: seen this tab, viewed anywhere (8h), opened the case file (24h).
- A "resurfaced" tier that can bring back seen markets before the rest of the catalogue has been offered.
- A per-tab seen list capped at 200 ids in sessionStorage, which silently forgets the oldest ones.
- A refill loop that digs up to 3 catalogue pages at a time, at most one request every 10 seconds, and can declare itself finished ("Caught up") when a page comes back short.

Net effect: two readers with the same history can get different answers depending on which timer expired, and a reader who moves fast can hit an end-of-feed screen while thousands of untouched markets sit behind the paging window.

## The rule we want instead

One sentence, applied everywhere:

> A market you have seen, opened, passed, backed, sold or hidden does not come back until every other market has had its turn. When the catalogue runs out, a new pass begins and everything is available again.

Nothing else. No 8h/24h/7d timers, no resurface tier, no mid-pass repeats.

Important: this rule only decides *what is allowed in the feed*. It never decides the order. Order stays with the ranking engine we already have.

## How ranking and freshness combine

Two separate jobs, cleanly split:

```text
eligibility (the cycle rule)  ->  ranking (score)  ->  sequencing (variety)  ->  the queue
   "may this market appear?"      "how good for       "what rhythm does
                                   this person?"       the reader feel?"
```

- **Ranking is untouched.** The seven-component composite score keeps doing the work: tribe/opposition presence, people you follow in the market, your category and topic affinity, momentum and acceleration, divergence/opportunity, freshness of the question itself. A market you'd love still ranks first — the cycle rule only stops it being shown to you twice in one pass.
- **Sequencing is untouched.** The personal-match → rising → social → fresh → early → exploration rhythm, plus the category/creator/near-duplicate run limits, still shapes what you actually feel while scrolling.
- **The candidate pool stays wide.** The eight-slice pool (active, fresh, classified, affinity, etc.) is what guarantees tribe and interest markets are in the running at every depth, not just the loudest markets. Deeper pages keep pulling from the same slices, so page 5 is still ranked for you — it is not a leftovers bin.
- **The pass roll re-ranks from the top.** When a new cycle begins, everything becomes eligible again and the highest-scoring markets for you now — with today's tribe activity and today's momentum — lead the new pass. A second pass is not a replay of the first.

The one ranking adjustment worth making: while the score already rewards personal signal, deeper pool pages currently risk drifting toward generic activity. We will make the affinity and social components a *floor* on deep pages — a market with tribe or followed people in it can never be outranked by a purely-loud market at the same depth — so the feed stays personal all the way down rather than only at the top.

## What changes


**1. Cycle instead of cooldowns**
Every viewer gets a current pass ("cycle") with a start time. A market is excluded from the feed if the viewer interacted with it — any kind — since the cycle started. Hidden markets stay the one permanent exception.

**2. The pass rolls automatically**
When the ranked pool comes back with nothing new at the deepest page, the feed does not stop and does not start repeating early. It starts a new cycle: the interaction ledger cut-off moves to now, the client's seen list clears (minus the handful of markets just on screen, so the first card of the new pass is never the last card of the old one), paging resets to page 0, and loading continues without the reader noticing.

**3. Continuous loading**
Refill stays driven by reading position (fewer than N markets ahead), but it can no longer bottom out: "no fresh markets" now means "roll the pass", not "you're done". The 10s throttle is bypassed when the queue is genuinely empty so a fast reader is never stalled at a blank list. The "Caught up" end-screen only remains for the non-personalised lenses, which are genuinely finite.

**4. Seen memory that matches the rule**
The per-tab 200-id cap and sessionStorage lifetime are replaced with cycle-scoped storage keyed by wallet (or anonymous visitor id), holding the whole pass. Signed-in viewers keep the server-side ledger as the source of truth; anonymous viewers get the same behaviour from the browser copy.

## Trade-offs worth naming

- Backed markets disappear from discovery for the rest of the pass, exactly like seen ones. Positions remain visible in My Convictions and via search — discovery just stops re-offering them.
- A pass over the whole catalogue is long. Someone who browses lightly may never trigger a roll, which is the intended outcome: they always get something new.
- Passing a market no longer carries extra weight (a "twice passed" market is treated the same as a seen one). That is the simplification being asked for; if repeat-pass suppression matters later, it can be re-added as a single cross-cycle rule.

## Technical notes

- `src/domain/feed/eligibility.ts`: collapse `FeedTier` to eligible/blocked. Exclusion becomes "any interaction at or after `cycleStartedAt`" plus permanent `hidden`. Remove `RESURFACEABLE`, `resurfaceAt`, `sessionSeenRank` and the per-reason cooldown reads. Keep the `ExclusionReason` labels for diagnostics.
- `src/domain/feed/config.ts`: delete `COOLDOWNS` (keep `HIDDEN` as the one permanent case). Everything else in the file stays.
- `src/domain/feed/sequence.ts`: drop the resurface pass; `exhausted` now means "this cycle is spent", which is a signal to roll rather than a terminal state.
- `src/lib/opportunity-feed.server.ts` + `.functions.ts`: replace the `allowResurface` input with `cycleStartedAt` (ISO string, validated); filter `viewer_market_events` / `viewer_market_decisions` / positions by that timestamp in `src/lib/feed/viewer-signals.server.ts`. Response reports `cycleSpent` in place of the old exhausted-for-For-You meaning.
- `src/lib/feed-session.ts`: cycle-scoped seen store (localStorage, keyed by wallet or visitor id, no 200 cap), plus `rollCycle()` that stamps a new start time and clears the set except the last few ids.
- `src/routes/index.tsx`: `fetchMore` loses the two-pass `resurfacingRef`; a `bottom` verdict calls `rollCycle()` and restarts the dig at page 0 once. `pagedOut` / `CaughtUp` remain only for non-For-You lenses. Empty-queue refills bypass `FEED_REFILL_MS`.
- Tests to update: `eligibility.test.ts`, `sequence.test.ts`, `pool.test.ts` (unchanged behaviour, but resurface fixtures go), plus a new test that a spent cycle rolls and re-admits everything.
