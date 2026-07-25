-- Give the chain poller a real wall-clock budget per tick.
--
-- The cron calls used net.http_post WITHOUT timeout_milliseconds, so pg_net's
-- 5s default applied. The chain poller scans the chain over a rate-limited
-- public RPC and cannot finish a meaningful amount of work in 5s; on the
-- serverless host the function is torn down when pg_net disconnects. Combined
-- with the old "advance the cursor only at end-of-run" behavior, every tick
-- made zero durable progress and re-scanned the same range forever.
--
-- The poller now advances its cursor durably per chunk, so it can no longer get
-- permanently stuck; this raises the timeout to 30s so each healthy tick covers
-- many chunks and the backfill actually catches up. Only the chain-poller jobs
-- are touched — the other cron jobs are quick and keep the 5s default.

-- Prod job (from ...211201_*.sql).
SELECT cron.unschedule('conviction-chain-poller');
SELECT cron.schedule('conviction-chain-poller','*/1 * * * *', $$
  SELECT net.http_post(
    url := 'https://project--c585b86f-545d-455e-9e85-a94f5211e352.lovable.app/api/public/jobs/chain-poller',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer '||(SELECT value FROM private.config WHERE key='ingest_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
$$);

-- Preview job (from ...213058_*.sql).
SELECT cron.unschedule('chain-poller-preview');
SELECT cron.schedule('chain-poller-preview','*/1 * * * *', $$
  SELECT net.http_post(
    url := 'https://project--c585b86f-545d-455e-9e85-a94f5211e352-dev.lovable.app/api/public/jobs/chain-poller',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer '||(SELECT value FROM private.config WHERE key='ingest_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000);
$$);
