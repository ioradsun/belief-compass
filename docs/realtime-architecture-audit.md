# Realtime Architecture Audit

_A first-principles review of the client data path, against the standard:_
**Snapshots establish truth. Events maintain truth. Components observe truth.**

This is the audit deliverable. It documents the current data flow before any
code changes, so that optimizations _replace_ duplicated logic rather than
layer on top of it. No production code is changed by this document.

---

## 0. Verdict in one sentence

**The backend is already at the target architecture — one canonical event log,
one reducer, one position state, one market read model, all published to
`supabase_realtime` — but the browser never subscribes to any of it and instead
maintains truth by polling ~23 independent timers.**

The expensive half of the philosophy ("Loading should happen once. Moving
should happen forever.") is _inverted_ on the client: loading is excellent
(SSR snapshot + persisted cache), but **moving is done by re-loading**. The
single highest-leverage change in the entire repo is to make the browser
_listen_ to the stream the database is already emitting.

---

## 1. What is already right (do NOT rebuild these)

Much of the philosophy is already implemented — on the server. Rebuilding it
would be the exact "layering on top of" mistake the audit exists to prevent.

| Philosophy principle | Already implemented as | Evidence |
|---|---|---|
| Snapshots establish truth | SSR loader serves a warm anon feed on first paint; `restoreQueryCache` re-hydrates last session instantly | `src/routes/index.tsx:182`, `src/lib/query-persist.ts` |
| One reducer, deterministic | `applyTrade` / `evaluate` pure fold, property-tested for split-associativity & idempotent replay | `src/lib/positions/position-core.ts`, `REDUCER-TESTS.md` |
| One canonical history | `events` table is the single source of truth; `trades`/`feed_events` are locked compatibility projections | `docs/data-flow.md`, `docs/data-ownership.md` |
| One position state | `wallet_beliefs`, incremental cursor-advanced applier, exactly-once | `docs/data-flow.md` Phase 3 |
| One market read model | `market_state`, one row per market, single writer `refresh-market.server.ts` | `docs/data-flow.md` Phase 4 |
| Patch, don't refold | Incremental applier updates ONE (wallet, market) pair per trade | `src/lib/positions/apply-events.server.ts` |
| Clean client/server boundary | Zero direct Supabase calls in components/hooks — all reads flow through 68 server functions | grep: `integrations/supabase/client` unused in `src/components`, `src/hooks` |

**The stream already exists and is already published:**

```
supabase/migrations/20260729000000_events_canonical_log.sql:86
    ALTER PUBLICATION supabase_realtime ADD TABLE public.events;
supabase/migrations/20260724210058_...:111
    ALTER PUBLICATION supabase_realtime ADD TABLE public.market_state;
```

`events` and `market_state` are broadcast-ready. **Nothing in `src/` ever opens
a channel.** (`grep -r '.channel(' src` → 0 hits; the only `subscribe` in the
client is the React Query _cache_ listener in `query-persist.ts`, not a
websocket.)

---

## 2. The transport inventory (the checklist)

### 2a. Realtime subscriptions

| Count | |
|---|---|
| Tables published to `supabase_realtime` | **3** (`events`, `market_state`, `feed_events`) |
| Client `.channel()` / `postgres_changes` subscriptions | **0** |
| Application-level realtime coordinator | **does not exist** |
| Client-side event reducer | **does not exist** |

### 2b. Polling loops (`refetchInterval`) — how "moving" is actually done

23 independent poll timers across 15 files. The fastest three run every 6–8s
and drive the primary surface:

| Interval | Query | File |
|---|---|---|
| 6s | live tape | `LiveTape.tsx:82` |
| 8s | **opportunity feed** | `index.tsx:119` |
| 8s | **market pulses (feed)** | `index.tsx:129` |
| 8s | positions tape | `MyConvictions.tsx:273` |
| 12s | my-convictions | `MyConvictions.tsx:201` |
| 15s | market-change | `MarketDeck.tsx:172`, `CurrentMarketActivity.tsx:43`, `CaseFile.tsx:104`, `CaseStory.tsx:64` |
| 15s | current market activity | `CurrentMarketActivity.tsx` |
| 20s | conviction-market / mobile / order quote | `MarketDeck.tsx:297`, `MobileGame.tsx:112`, `OrderTicket.tsx:38` |
| 30s | creator fees (×2, on-chain) | `creator-fees.ts:41,48` |
| 60s | evidence / network / person / dna / welcomes / shared | 8 sites |
| 120s | welcomes received | `Welcome.tsx:255` |

**Note:** the feed is _two_ parallel 8s polls (`opp-feed` + `market-pulses`)
for what is one logical surface. That alone is one redundant round-trip every
8 seconds, forever, for every open tab.

### 2c. Server functions (the RPC/Supabase surface)

**68** `createServerFn` entry points across 16 `*.functions.ts` files. These
are the only way the client reads data. This is a healthy chokepoint — it is
exactly where a "one snapshot" endpoint and a "one event stream" projection
should be assembled, and where broad polling should be collapsed.

---

## 3. Duplicate caches & duplicated reads

### 3a. Genuine duplicate cache (same data, two key shapes)

Market pulses for a single market are cached **twice**, under incompatible keys:

```
index.tsx:126     ["market-pulses", ids.join(",")]      // e.g. "12,45,88"  (the feed)
MobileGame.tsx:606 ["market-pulses", String(marketId)]  // e.g. "12"        (one market)
```

Both call `listMarketPulses`. The same market's pulse can live in two cache
entries, refetched on two timers, never converging. This is the canonical
"duplicated market object" the philosophy calls out.

### 3b. The same query key fetched by many components

React Query dedupes _identical_ keys when mounted simultaneously, so these are
not always N round-trips — but each is an independent observer with its own
`refetchInterval`/`staleTime`, and each couples a component directly to a raw
read instead of to a canonical cached object:

| Query key | # of components declaring it |
|---|---|
| `["network", viewer, "all", "relevant", ""]` | **7** (CaseStory, MobileGame ×2, DnaFirstReveal, MarketDeck, SharedConviction, CaseFile) |
| `["evidence", marketId]` | **6** (CaseStory, MobileGame ×3, MarketDeck, SharedConviction, CaseFile) |
| `["market-change", marketId]` | **5** (MobileGame, MarketDeck, CurrentMarketActivity, CaseFile, CaseStory) |
| `houseKey(viewer, marketId)` | **3** (MobileGame, MarketDeck, CurrentMarketActivity) |
| `["conviction-market", marketId]` | **3** (MobileGame, MarketDeck ×2) |

The `"all","relevant",""` network tuple is a hard-coded literal repeated in 7
files — a single object every side-panel wants, expressed as 7 separate
subscriptions to the same read.

### 3c. Per-market fan-out (the polling-world "waterfall")

Opening **one** market on connected desktop sustains roughly a dozen concurrent
poll loops, because each panel fetches its own slice of the _same_ market:

```
center feed:     opp-feed (8s) + market-pulses (8s)
market deck:     market-change (15s) + conviction-market (20s) + evidence (60s)
                 + network (60s) + house + position-summary
right column:    live-tape (6s) + current-market-activity (15s, shares market-change key)
left column:     my-convictions (12s) + positions-tape (8s)
chrome:          welcomable (60s) + welcomes-received (120s) + wallet-link + creator-fees (30s)
```

Every one of these is the browser _asking the backend what changed_ — the exact
responsibility the philosophy says the frontend should not have. A single trade
on the visible market should patch price, feed, position, and portfolio from one
event; today it is discovered up to 5 different times by 5 different timers with
5 different latencies, so the surfaces visibly disagree for seconds at a time.

---

## 4. Broad invalidations

| Site | Invalidation | Assessment |
|---|---|---|
| `index.tsx:469`, `house-round.ts:38` | `invalidateQueries(["opp-feed"])` | Broad refetch of the whole feed on refresh/house action. Acceptable as a user-initiated refresh; wasteful if it fires on routine events. |
| `ProfileEditor.tsx:63-64` | `invalidateQueries(["person"])`, `(["pov-user"])` | **Prefix-broad** — invalidates every person/pov cache to reflect one edited profile. |
| `admin.tsx:40,75` | `invalidateQueries()` | **Entire cache** — admin-only, tolerable. |

There is no per-event targeted cache patching anywhere on the client, because
there is no event stream to drive it. Today the only tools are "poll again" and
"invalidate a whole family."

---

## 5. Rerender & memory notes

- **Rerender hotspots:** `Feed` (`index.tsx`) subscribes to the whole `opp-feed`
  payload (`items`, `rows`, `idea`, `ethUsd`) and re-derives `orderedRows`,
  `reasonByMarket`, `ids` on every 8s poll — so a price tick anywhere in the feed
  re-runs the top-level component and every card. The philosophy's "every
  component subscribes to the smallest possible record" is not yet realized:
  panels subscribe to whole feed/market payloads, not to `price` / `position` /
  `momentum` atoms.
- **`new QueryClient()` has no `defaultOptions`** (`router.tsx:6`) — default
  `staleTime: 0`, `gcTime: 5min`. Every query re-specifies its own cadence, and
  there is no global backpressure/batch policy. This is the natural home for a
  single "batch events into one animation frame" render policy.
- **Memory:** `query-persist.ts` bounds the persisted cache well (3MB cap,
  12h age-out, whitelist, BUILD_ID bust). The unbounded surfaces would be the
  live feed / processed-event history _once a stream exists_ — they do not exist
  yet, so there is nothing to bound today, but they must be bounded from day one.

---

## 6. Gap analysis vs. the target

| Target | Status | Gap |
|---|---|---|
| One initial snapshot | ✅ SSR + persisted cache | Feed snapshot is split into 2 queries (`opp-feed` + `market-pulses`); could be one payload |
| One shared event stream | ❌ | `events`/`market_state` are published but nothing subscribes. **This is the whole gap.** |
| One reducer (client) | ❌ | Server reducer exists; no client reducer applies events to cache |
| One canonical client cache | ⚠️ | React Query is the cache, but market objects are duplicated (§3a) and read under many keys (§3b) |
| Patch, don't reload | ❌ | Truth is maintained by 23 polls + broad invalidations, never by delta patches |
| Batch rapid events → one render | ❌ | No batching layer; each poll result renders independently |
| Reconnect from cursor | ❌ | No stream, so no cursor resume; reconnect = the polls simply resume |
| Predictive prefetch | ⚠️ | Code-split chunks are prefetched (`index.tsx:234`); market _data_ for next/prev is not |

---

## 7. Recommended sequence (replace, don't layer)

Ordered by leverage. Each step deletes more than it adds. **None require
backend work — the stream, reducer semantics, and read model already exist.**

> **Status (steps 1–3 landed).** `src/lib/realtime/coordinator.ts` opens one
> socket to the already-published `market_state` stream (dynamically imported so
> supabase-js stays off the first-paint bundle); `src/lib/realtime/reduce.ts` is
> the one client reducer that batches rows per animation frame and patches the
> shared React Query cache, preserving server enrichments and ordering by
> `read_model_version`. Wired in `__root.tsx` beside the persist/restore. The
> feed's 8s poll became a 20s structural reconcile (`index.tsx`). Reducer locked
> by `src/lib/realtime/reduce.test.ts`. Dead code removed: `ReportMarket.tsx`
> (unreferenced) and `integrations/supabase/auth-middleware.ts` (its own comments
> confirmed `requireSupabaseAuth` is unused); `lib/shims/events.ts` was checked
> and **kept** — it is live via the Vite `events` alias for the wallet SDK.
> Follow-ups: the `events` stream for pulses/live-tape, `wallet_beliefs` for
> positions, then predictive prefetch + cursor reconnect (steps 4–6).
>
> **Events stream (landed, follow-up).** The same coordinator now also subscribes
> to the published `events` stream (`INSERT`, `kind=eq.trade`). The live tape and
> per-card pulses are **server-narrated** DTOs (composed story beats, resolved
> profiles, personal/network detection), so a trade is treated as a *signal*, not
> a delta to fold on the client — re-narrating them here would duplicate real
> server logic. On a trade the coordinator refetches only the affected narrated
> slices (`affectedPulseKeys` picks the intersecting pulse caches; the mounted
> live tapes refetch their cheap cursor-delta), coalesced + throttled
> (`ACTIVITY_THROTTLE_MS`) so a burst is one refresh. With freshness now
> event-driven, LiveTape's 6s poll and the feed's 8s pulse poll became 30s safety
> reconciles; a recovered socket reconciles feed + activity once. Quiet markets
> cost zero fetches.
>
> **Positions stream (landed, follow-up).** `wallet_beliefs` is now published to
> `supabase_realtime` (migration `20260814000000`). Unlike the global streams,
> positions are per-viewer, so `usePositionStream(wallet)` (mounted once in
> `Feed`) opens ONE subscription **filtered to the connected wallet**
> (`wallet=eq.<addr>`) with its own lifecycle — it re-subscribes on wallet change.
> Positions are server-valued (POV worth, ETH→USD cost basis, joined meta), so a
> belief change is a signal to refetch the mounted position slices
> (`viewerPositionKeys`), coalesced + throttled — never a client re-valuation.
> Others' trades on a viewer's position markets refresh the left-column network
> tape precisely via `affectedPositionsTapeKeys` off the events stream. The
> portfolio poll (12s) and positions-tape poll (8s) became 30s reconciles.
>
> **Predictive prefetch + reconnect (landed, steps 5–6).**
> `usePredictivePrefetch` (in `Feed`) warms the immediate neighbors' deck-core —
> next, next+1, previous, *nothing else* — into the same cache the deck reads, on
> `requestIdleCallback` so it never competes with the active render; the
> likely-next market gets the full trio (market-change + evidence + creator),
> the others just the deck-core. `neighborIds` is pure/tested. Reconnect is
> reconcile-not-reload: the coordinator re-syncs the visible surfaces once
> (debounced) on socket-error recovery **and** on the browser's own `online` /
> tab-visible signals. Because the client refetches rather than folds deltas, a
> refetch *is* the resume — and the live tape resumes from its **own cursor** (its
> queryFn fetches only events newer than the row it already holds), so a
> reconnect replays just the missed tail. **All six audit steps are now landed.**

1. **Open the stream that already exists.** One app-level realtime coordinator
   subscribes _once_ to `market_state` (and `events` for activity). Components
   never subscribe. This is net-new but small — the DB side is done.

2. **One client reducer → the existing cache.** Every realtime row enters one
   deterministic handler that patches the React Query cache in place
   (`queryClient.setQueryData`) — market rows, pulses, feed. Dedupe by
   `(block_number, log_index)` / `read_model_version`, mirroring the server's
   ordering guarantees. No component writes cache directly.

3. **Delete the polls the stream makes redundant.** Once `market_state` streams,
   drop `refetchInterval` from `opp-feed`, `market-pulses`, `market-change`,
   `conviction-market`, `live-tape`, `current-market-activity`. Keep a slow
   safety re-sync (e.g. 60s) and on-focus refetch as reconciliation, not as the
   primary transport. This is where most of the 23 timers disappear.

4. **Collapse the duplicate pulse cache (§3a)** and the repeated `network`
   literal (§3b) into single canonical selectors, so every surface reads one
   object.

5. **Batch renders:** coalesce a burst of realtime rows into one reducer pass
   per animation frame before writing cache — the philosophy's "40 trades in
   100ms → one smooth update." Natural to add as a `defaultOptions` + a small
   queue in the coordinator.

6. **Then** predictive data prefetch (next/prev market `market_state`) and
   cursor-based reconnect — cheap once 1–3 exist, premature before.

**Explicit non-goals for this work:** do not add a second cache, do not
re-implement the server reducer on the client (only _apply_ its already-ordered
output), do not touch the `events`/`trades`/`wallet_beliefs`/`market_state`
ownership rules in `docs/data-ownership.md`, and do not rebuild the SSR snapshot
path — it is already correct.

---

## 8. Correctness guardrails to preserve

- **Contract authority is unchanged:** the trade flow re-quotes on-chain before
  execution (`query-persist.ts` note); a streamed/stale display price must never
  drive a bet. The stream feeds _display_, not execution.
- **Ordering:** client dedupe/patch must use the same canonical order the server
  uses (`block_number ASC, log_index ASC`; `read_model_version` for `market_state`),
  so a late/out-of-order realtime row is a no-op, never a regression — exactly as
  `apply_position_events` guards the server side.
- **Reconcile, don't trust blindly:** keep a slow background re-sync + on-focus
  refetch so a missed realtime event self-heals, matching the server's
  periodic-verification stance.

---

_Appendix — commands used: `grep -rc createServerFn src` (68); `grep -rn refetchInterval src` (23);
`grep -rn 'ALTER PUBLICATION supabase_realtime' supabase/migrations` (events, market_state, feed_events);
`grep -rn '.channel(' src` (0)._
