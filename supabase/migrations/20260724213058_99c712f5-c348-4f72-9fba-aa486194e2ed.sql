select cron.unschedule(jobid) from cron.job where jobid in (5, 6, 7, 8);

select cron.schedule(
  'pov-poller-preview',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--c585b86f-545d-455e-9e85-a94f5211e352-dev.lovable.app/api/public/jobs/pov-poller',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer '||(SELECT value FROM private.config WHERE key='ingest_secret')),
    body := '{}'::jsonb);
  $$
);

select cron.schedule(
  'chain-poller-preview',
  '*/1 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--c585b86f-545d-455e-9e85-a94f5211e352-dev.lovable.app/api/public/jobs/chain-poller',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer '||(SELECT value FROM private.config WHERE key='ingest_secret')),
    body := '{}'::jsonb);
  $$
);

select cron.schedule(
  'belief-rollup-incremental-preview',
  '*/1 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--c585b86f-545d-455e-9e85-a94f5211e352-dev.lovable.app/api/public/jobs/belief-rollup?mode=incremental',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer '||(SELECT value FROM private.config WHERE key='ingest_secret')),
    body := '{}'::jsonb);
  $$
);

select cron.schedule(
  'belief-rollup-sweep-preview',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--c585b86f-545d-455e-9e85-a94f5211e352-dev.lovable.app/api/public/jobs/belief-rollup?mode=sweep',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer '||(SELECT value FROM private.config WHERE key='ingest_secret')),
    body := '{}'::jsonb);
  $$
);