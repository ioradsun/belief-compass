-- Phase 3 — schedule the position repair + reconciliation workers.
--
-- The obsolete full-refold "hot path" was NOT a separate cron: it was inline in
-- the chain poller (which now applies incrementally), so there is no hot-path job
-- to unschedule. The belief-rollup cron remains — it is now purely the position
-- EVALUATOR (price/time-driven fields), which it always was here.
--
-- New jobs:
--   position-rebuilder  — dirty-pair rebuild + inserted-but-unapplied recovery
--   position-reconcile  — nightly rolling drift detection + repair
--
-- NOTE: the host mirrors the other job crons; if the live deployment host differs,
-- update these URLs (and the other job schedules) to match. Auth reuses the shared
-- ingest secret in private.config.

SELECT cron.schedule('conviction-position-rebuilder','*/2 * * * *', $$
  SELECT net.http_post(
    url := 'https://project--c585b86f-545d-455e-9e85-a94f5211e352.lovable.app/api/public/jobs/position-rebuilder',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer '||(SELECT value FROM private.config WHERE key='ingest_secret')),
    body := '{}'::jsonb);
$$);

-- Rolling reconciliation kicks off nightly and (at scale) continues in bounded
-- chunks; a single nightly tick processes one bounded batch.
SELECT cron.schedule('conviction-position-reconcile','17 3 * * *', $$
  SELECT net.http_post(
    url := 'https://project--c585b86f-545d-455e-9e85-a94f5211e352.lovable.app/api/public/jobs/position-reconcile',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer '||(SELECT value FROM private.config WHERE key='ingest_secret')),
    body := '{}'::jsonb);
$$);
