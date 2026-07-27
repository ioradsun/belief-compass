-- The DNA matcher (Job M / dna-batch) populates wallet_matches — the table the
-- live app reads for every match %, ring, and Tribe. It was never scheduled, so
-- wallet_matches was never (re)computed and the whole social layer rendered
-- blank. Schedule it. It recomputes all wallets each run, so keep it at a modest
-- cadence. Host mirrors the other job crons — update if the live host differs.
-- Idempotent: unschedule any prior copy of this job before (re)scheduling.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dna-matcher-preview') THEN
    PERFORM cron.unschedule('dna-matcher-preview');
  END IF;
END $$;

select cron.schedule(
  'dna-matcher-preview',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--c585b86f-545d-455e-9e85-a94f5211e352.lovable.app/api/public/jobs/dna-matcher',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer '||(SELECT value FROM private.config WHERE key='ingest_secret')),
    body := '{}'::jsonb);
  $$
);
