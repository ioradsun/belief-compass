# Conviction DNA (v1)

Conviction DNA is the social/identity layer: verified relationships derived from
expressed market positions. It scales with the viewer's shared-belief
neighborhood — **no production job compares every wallet with every other.**

## The one path

```
express a belief
  → canonical event → position update (wallet_beliefs)
  → match-relevant change? → bump wallet DNA version (wallet_match_version)
  → enqueue viewer → bounded candidate discovery (find_match_candidates RPC)
  → exact DNA (scoreRelationship) + per-domain (scoreDomains)
  → classify with hysteresis (classifyRelationship)
  → viewer_dna_cache (twin/tribe/neutral/opp/inverse + closest + Circles)
  → left-column Network row → center person profile
```

## Canonical modules (one owner each)

| concern | module |
|---|---|
| thresholds + engine version | `src/domain/dna/config.ts` |
| exact scoring | `src/domain/dna/score.ts` (`scoreRelationship`) |
| classification + hysteresis | `src/domain/dna/classify.ts` |
| per-domain Circles | `src/domain/dna/domains.ts` |
| candidate generation | `src/domain/candidates.ts` + `find_match_candidates` RPC |
| viewer cache | `src/lib/dna/viewer-dna-cache.server.ts` |
| compute orchestrator | `src/lib/dna/compute-viewer-dna.server.ts` |
| refresh worker | `/api/public/jobs/match-worker` (drains `match_queue`) |
| API | `src/lib/dna.functions.ts` |

## Scoring (score.ts)

`agreement` is the **conviction-weighted same-side fraction** over shared
directional markets, in `[0,100]`:

- shared weight per market = `sqrt(convictionA · convictionB)`
- `agreement = 100 · Σ(same-side weight) / Σ(shared weight)`
- `confidence = shared / (shared + 8)` — **separate** from agreement
- `evidenceLevel`: 0–4 insufficient · 5–9 early · 10–24 growing · 25+ established

Confidence is never folded into agreement, so a small perfect sample reads
"100% · 6 shared · Early", not a misleadingly low number.

## Classification thresholds (config.ts) — agreement %, with hysteresis

| label | enter | exit | min shared | min confidence |
|---|---|---|---|---|
| Twin | ≥93 | 90 | 20 | 0.70 |
| Tribe | ≥77 | 72 | 8 | 0.40 |
| Opp | ≤33 | 38 | 8 | 0.40 |
| Inverse | ≤10 | 15 | 20 | 0.70 |
| Neutral | — sufficient evidence, no strong lean — | | | |
| Insufficient | < 5 shared directional beliefs | | | |

A held label survives to its (looser) exit threshold before dropping — relationships don't flap at a boundary. Per-domain Circles use the same scorer with a 5-shared floor.

## Candidate generation & scale

`find_match_candidates` (SQL RPC) aggregates the directional slice of
`wallet_beliefs` (partial indexes `wb_dir_*`), distinctiveness-weights rarer
shared beliefs, prunes below the shared minimum, and caps the pool. Only that
bounded set (≤ `DNA_LIMITS.maxExactScored` = 300) is exact-scored. Retained
buckets are capped at 30 each.

## Cache + invalidation

`viewer_dna_cache` — one bounded row per viewer (never an all-pairs graph):
`twin/tribe/neutral/opp/inverse` buckets + `closest_matches` + `domain_matches`
(Circles). Fresh iff `viewer_dna_version == wallet_match_version.version` **and**
`engine_version == DNA_ENGINE_VERSION` **and** not expired (15-min TTL).

`wallet_match_version` is the canonical per-wallet DNA clock. Its trigger bumps on
a **match-relevant** change: directional (de)activation, a YES↔NO flip, or a
material conviction move (`|Δ| ≥ 0.05`) — never on metadata. The bump lazily
expires only that viewer's own cache (no fan-out); other viewers age out via TTL
or their next request; the feed/Network enqueue a bounded refresh on a miss.

## API (server functions)

- `getNetwork(wallet, relationship?, sort?, query?, cursor?, limit?)` — the
  left-column list: summary + freshness + paginated people (server-side search,
  filter, sort; profiles + latest activity joined).
- `getDnaOverview(wallet)` — counts, closest people, Circles, divisions, identity line.
- `getPersonProfile(wallet, viewer)` — viewer-relative relationship, aligned/opposed
  domains, shared/opposing beliefs, recent activity. Computed on demand for any wallet.

## Diagnostics

`npm run check:dna` — `--viewer W` trace, `--pair A B` exact score, cache scan
(fails on below-gate rows, cap breaches, a wallet in two opposing buckets,
non-canonical wallets, or the retired `viewer_match_cache`/`wallet_matches` tables
reappearing).

## Discovery moments (relationship events in Live)

Each cached relationship records `since` (when its CURRENT label was set) and
`previous` (what it was before). Both live inside the existing `*_matches` jsonb
columns, so there is no migration and no second table.

That one timestamp is the whole mechanism behind "you found a Twin". A discovery
moment is not an event anybody writes — it is a read-time projection over the
cache (`src/domain/discovery-moment`), so:

- no new pipeline, no cron, no `events` rows, no announced-ledger;
- the same network state always yields the same rows, so a poll that changes
  nothing re-renders nothing;
- a moment expires by itself once `since` falls outside the window.

A relationship seen for the FIRST time gets no timestamp on purpose. We do not
know when it formed — the first computation covers all of a viewer's history —
and dating it "now" would announce a Twin they have had all along.

Ranking uses these through a second dimension, **discovery**
(`src/domain/discovery`): how much an event introduces the reader to someone
worth meeting, blended with significance by the cadence mixer. It is viewer-
relative and never persisted, and it deliberately reads no dollar amount.

## Deferred to a follow-up (documented, not built in v1)

- Active-viewer **registry** + reverse-index fan-out to mark other active viewers
  stale within seconds (v1 relies on version + TTL + on-request refresh).
- Global person **on-demand lookup** UI entry point (the server path exists via
  `getPersonProfile`; no global directory is added).
- Diagnostics **dashboards** / structured instrumentation counters.
- Integration/UI test suites that require a live database.
- Center **routes** `/person/:wallet` `/dna` are implemented as `?p` / `?dna`
  search params on `/` (preserves the 3-column shell; history still works).
