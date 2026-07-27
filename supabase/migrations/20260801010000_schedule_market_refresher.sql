-- Phase 4 — schedule the market read-model refresher.
--
-- Dirty markets are enqueued by the chain poller (activity/positions), POV poller
-- (pov) and the position rebuilder (positions); this worker drains the coalesced
-- queue and recomputes market_state. NOTE: host mirrors the other job crons; auth
-- reuses the shared ingest secret in private.config.

SELECT cron.schedule('conviction-market-refresher','*/1 * * * *', $$
  SELECT net.http_post(
    url := 'https://project--c585b86f-545d-455e-9e85-a94f5211e352.lovable.app/api/public/jobs/market-refresher',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer '||(SELECT value FROM private.config WHERE key='ingest_secret')),
    body := '{}'::jsonb);
$$);
