
# Conviction DNA v2 — per-domain identity

Ship the four rules from the spec on top of the existing match math. No new primitives — a category dimension over `wallet_beliefs`. Words stay disciplined: **Tribe/Opp** = overall, **Circles** = per-domain.

## 1. Category spine (RULE 2 — deterministic, versioned, stored)

`markets.category` already holds POV `categorySlug` for every ingested market. Freeze it as the spine and add version tracking.

- Migration: add `markets.category_version int not null default 1`, `markets.category_source text` (`'pov' | 'ai' | 'unknown'`), and backfill (`category_source='pov'` where non-null, `'unknown'` where null).
- Add a **canonical domain map** in `src/domain/categories.ts`: POV slug → one of 9 domains (Relationships, Money, Technology, Society, Human Nature, Politics, Morality, Health, Entertainment). Frozen constant; bump `DOMAIN_MAP_VERSION` to reclassify.
- Skip AI classification for v2 — unknown markets simply don't count toward any Circle. (Honest missing spokes.) AI gap-fill is a follow-up.

## 2. Circle match (RULE 1 — honesty gate)

Extend `matchScore` in `src/domain/domain.ts` with a `domain` grouping helper:

- `circleMatches(a, b)` returns `Map<domain, MatchResult>` by partitioning shared factors by their market's domain, reusing the existing agreement × conviction-weight × confidence formula.
- The existing `MIN_SHARED_MARKETS = 5` gate applies **per Circle** — a Circle with < 5 shared markets returns `insufficient: true` and is never surfaced as a number.
- Overall Tribe/Opp stays the current global match.

Server: new `getCirclesForWallet` in `src/lib/match.functions.ts` (mirrors `getMatchesForWallet`), joining `wallet_beliefs` → `markets.category` → domain, returning per-domain top allies + top rivals with confidence. Cache in `wallet_matches` — add `domain text` column (nullable = overall) and unique `(wallet, matched_wallet, domain)`.

## 3. Fingerprint UI

On `/wallet/$addr`:

- **Radial fingerprint** (SVG, no chart lib): 9 spokes, one per domain. Spoke length = viewer's Circle match with this wallet; spokes below the confidence floor render as a faint dashed stub with "not enough shared beliefs yet" on hover. Overlay mode when a second wallet is selected.
- **Partial-match card**: "You and 0xabc: 96% Money, 72% Politics, — Technology (blurry)". Only surfaces Circles above the floor; blurry ones are labeled, never numbered.
- **Circle lists**: for each qualifying domain, top ally + top rival with match %, shared count, and confidence bar.

On `/market/$id`: swap the current global "who to watch" for the **market's domain Circle** — e.g. "AI Circle · N people · avg match X%". Fallback to overall Tribe only when the market's domain is `unknown`.

## 4. Progression copy (RULE 3)

Reframe empty/thin states in the wallet view and dashboard: never counts, never XP. Copy pattern: *"Your {Domain} fingerprint is still blurry — {n}/5 shared markets."* Taking positions sharpens confidence; no reward language.

## 5. Archetypes (RULE 4) — deferred

Explicitly out of scope for this PR. Cluster stability requires a recompute cadence and separation metrics we haven't built. Note in `REDUCER-TESTS.md` as follow-up so it isn't shipped half-honest.

## Tests

Extend `src/domain/domain.test.ts`:
- Per-domain partitioning: agreement in one domain doesn't leak into another.
- Confidence floor: Circle with 4 shared → `insufficient: true`; with 5 → surfaced.
- Nuanced opposition: constructed pair where Money = ally, Politics = rival, both above floor.

## Technical notes

- Migration adds `category_version`, `category_source` to `markets`; adds `domain` column + updated unique constraint to `wallet_matches`. Includes `GRANT`s per public-schema rule.
- `wallet_matches` cache key becomes `(wallet, domain)` with `domain IS NULL` = overall Tribe. Existing overall rows keep working (backfilled with `domain = null`).
- No changes to Jobs A/B/C — Circles are derived on read via Job M.

## Out of scope (this PR)

- AI classification of unknown-category markets.
- Emergent archetype clustering.
- Fingerprint overlay across arbitrary N wallets (v2 supports pairwise only).
