-- finalize-occurred-at.sql
--
-- Run this MANUALLY, once, AFTER `npm run backfill:block-times` reports
-- trades_remaining_without_occurred_at=0. It is deliberately NOT a Supabase
-- migration: applied against a database that still has historical rows with a
-- NULL occurred_at, the SET NOT NULL would fail and block every later migration.
--
-- Step 1 — verify there is nothing left to backfill. This MUST return 0.
--          If it returns > 0, do NOT run step 2; rerun the backfill first
--          (some blocks may have been temporarily unfetchable).
SELECT count(*) AS trades_without_occurred_at
FROM public.trades
WHERE occurred_at IS NULL;

-- Step 2 — only when step 1 returned 0: make event time mandatory going forward.
-- The poller already stamps occurred_at on every new row, so this simply locks
-- in the invariant.
ALTER TABLE public.trades
  ALTER COLUMN occurred_at SET NOT NULL;

-- Step 3 — optional: drop the partial index that was only there to make the
-- backfill's "find rows still missing a time" scan cheap. Once occurred_at is
-- NOT NULL it can never match, so it is dead weight.
DROP INDEX IF EXISTS public.trades_occurred_null_idx;
