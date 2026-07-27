-- POV identity cache.
CREATE TABLE IF NOT EXISTS public.profiles (
  wallet       text PRIMARY KEY,
  username     text,
  display_name text,
  pfp_url      text,
  twitter_id   text,
  not_found    boolean NOT NULL DEFAULT false,
  fetched_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO anon, authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS profiles_public_read ON public.profiles;
CREATE POLICY profiles_public_read ON public.profiles
  FOR SELECT TO anon, authenticated USING (true);

-- Background DNA match queue.
CREATE TABLE IF NOT EXISTS public.match_queue (
  wallet       text PRIMARY KEY,
  enqueued_at  timestamptz NOT NULL DEFAULT now(),
  pending      boolean NOT NULL DEFAULT true,
  started_at   timestamptz,
  done_at      timestamptz,
  attempts     integer NOT NULL DEFAULT 0,
  last_error   text
);
CREATE INDEX IF NOT EXISTS match_queue_pending_idx
  ON public.match_queue (enqueued_at)
  WHERE pending;
ALTER TABLE public.match_queue ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.match_queue TO service_role;

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

-- Canonical event time on trades.
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS occurred_at timestamptz;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS ingested_at timestamptz;
UPDATE public.trades SET ingested_at = ts WHERE ingested_at IS NULL;
ALTER TABLE public.trades ALTER COLUMN ingested_at SET DEFAULT now();
ALTER TABLE public.trades ALTER COLUMN ingested_at SET NOT NULL;
ALTER TABLE public.trades ALTER COLUMN ts DROP NOT NULL;

CREATE INDEX IF NOT EXISTS trades_market_occurred_idx
  ON public.trades (onchain_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS trades_occurred_null_idx
  ON public.trades (block_number)
  WHERE occurred_at IS NULL;

CREATE OR REPLACE FUNCTION public.market_volume_window(p_ids bigint[], p_since timestamptz)
RETURNS TABLE(onchain_id bigint, side text, eth numeric, trade_count bigint)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT t.onchain_id, t.side, SUM(t.eth_amount)/1e18 AS eth, COUNT(*)::bigint AS trade_count
  FROM trades t
  WHERE t.onchain_id = ANY(p_ids)
    AND t.occurred_at IS NOT NULL
    AND (p_since IS NULL OR t.occurred_at >= p_since)
  GROUP BY t.onchain_id, t.side;
$$;

GRANT EXECUTE ON FUNCTION public.market_volume_window(bigint[], timestamptz)
  TO anon, authenticated, service_role;