-- Move DNA matching off the connect path. ensureConviction() used to run the
-- ≤50k-candidate match scan synchronously, blocking connect. Now it enqueues the
-- wallet here and a background worker (Job M2) computes + caches wallet_matches;
-- the feed reads that cache and refetches, so People/Opp light up within ~a
-- minute without slowing connect.
CREATE TABLE IF NOT EXISTS public.match_queue (
  wallet       text PRIMARY KEY,
  enqueued_at  timestamptz NOT NULL DEFAULT now(),
  pending      boolean NOT NULL DEFAULT true,
  started_at   timestamptz,
  done_at      timestamptz,
  attempts     integer NOT NULL DEFAULT 0,
  last_error   text
);

-- The worker only ever scans pending rows, oldest first.
CREATE INDEX IF NOT EXISTS match_queue_pending_idx
  ON public.match_queue (enqueued_at)
  WHERE pending;

-- Internal work queue: only the service role (which bypasses RLS) touches it.
ALTER TABLE public.match_queue ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.match_queue TO service_role;

-- Schedule the background matcher every minute. NOTE: the host below mirrors the
-- other job crons; if the live deployment host differs, update this URL (and the
-- other job schedules) to match. Auth reuses the shared ingest secret.
select cron.schedule(
  'match-worker-preview',
  '*/1 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://project--c585b86f-545d-455e-9e85-a94f5211e352.lovable.app/api/public/jobs/match-worker',
    headers := jsonb_build_object('Content-Type','application/json',
      'Authorization','Bearer '||(SELECT value FROM private.config WHERE key='ingest_secret')),
    body := '{}'::jsonb);
  $$
);
