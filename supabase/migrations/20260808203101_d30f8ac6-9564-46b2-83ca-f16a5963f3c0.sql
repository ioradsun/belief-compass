CREATE TABLE IF NOT EXISTS public.feed_snapshot (
  key text PRIMARY KEY,
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.feed_snapshot TO service_role;

ALTER TABLE public.feed_snapshot ENABLE ROW LEVEL SECURITY;