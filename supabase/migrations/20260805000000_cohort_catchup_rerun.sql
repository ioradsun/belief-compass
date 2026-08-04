-- Re-run the conviction-cohort catch-up sweep, once.
--
-- The sweep is self-terminating: it walks every market exactly once and stops
-- when its cursor passes the highest onchain_id. It did that correctly — and
-- emitted NOTHING, because every holder failed the $5 dust gate on a position
-- valued from `wallet_beliefs.yes_value_usd`, a column that had six readers and
-- no writer at all. `Number(null) === 0` made every believer look like dust.
--
-- With the valuation fixed (src/domain/position-value + the belief-rollup
-- writer), the sweep has real numbers to work with. Resetting the cursor is
-- what lets it recover the 7-day crossings that were lost on 2026-07-31, when
-- the emitter was still scoped to recently-traded markets and had never written
-- a row in its life.
--
-- SAFE TO RUN MORE THAN ONCE. A cohort's identity is (market · side · kind ·
-- rung · CROSSING DATE), carried in `events.source_key`, and the emitter upserts
-- with ignoreDuplicates. Re-walking ground it has already covered re-derives the
-- identical fingerprints and writes nothing new, so a second reset costs one
-- sweep of reads and produces no duplicate rows.
UPDATE public.calc_cache
SET value = 0, updated_at = now()
WHERE key = 'cohort_catchup_last_market';
