
-- Private schema holding the ingest bearer secret. Not exposed to any API role.
CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS private.config (
  key text PRIMARY KEY,
  value text NOT NULL
);
REVOKE ALL ON private.config FROM PUBLIC, anon, authenticated;
-- postgres (the role pg_cron runs as) retains full access as owner.

-- Reschedule cron jobs to read the secret from private.config instead of a GUC.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT jobname FROM cron.job WHERE jobname IN
    ('conviction-pov-poller','conviction-chain-poller',
     'conviction-belief-rollup-incremental','conviction-belief-rollup-sweep')
  LOOP EXECUTE format('SELECT cron.unschedule(%L)', r.jobname); END LOOP;
END $$;

SELECT cron.schedule('conviction-pov-poller','*/2 * * * *', $$
  SELECT net.http_post(
    url := 'https://project--c585b86f-545d-455e-9e85-a94f5211e352.lovable.app/api/public/jobs/pov-poller',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer '||(SELECT value FROM private.config WHERE key='ingest_secret')),
    body := '{}'::jsonb);
$$);

SELECT cron.schedule('conviction-chain-poller','*/1 * * * *', $$
  SELECT net.http_post(
    url := 'https://project--c585b86f-545d-455e-9e85-a94f5211e352.lovable.app/api/public/jobs/chain-poller',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer '||(SELECT value FROM private.config WHERE key='ingest_secret')),
    body := '{}'::jsonb);
$$);

SELECT cron.schedule('conviction-belief-rollup-incremental','*/1 * * * *', $$
  SELECT net.http_post(
    url := 'https://project--c585b86f-545d-455e-9e85-a94f5211e352.lovable.app/api/public/jobs/belief-rollup?mode=incremental',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer '||(SELECT value FROM private.config WHERE key='ingest_secret')),
    body := '{}'::jsonb);
$$);

SELECT cron.schedule('conviction-belief-rollup-sweep','*/15 * * * *', $$
  SELECT net.http_post(
    url := 'https://project--c585b86f-545d-455e-9e85-a94f5211e352.lovable.app/api/public/jobs/belief-rollup?mode=sweep',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer '||(SELECT value FROM private.config WHERE key='ingest_secret')),
    body := '{}'::jsonb);
$$);
