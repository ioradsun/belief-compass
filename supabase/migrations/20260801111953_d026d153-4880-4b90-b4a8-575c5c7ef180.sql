-- The House Has an Idea — personalized market-creation suggestions.
--
-- Suggestions are generated AHEAD of time by a background job and read back by
-- the feed. Nothing here is reachable from the browser: every access goes
-- through a server function using the service-role client, so no anon/
-- authenticated grants are issued and RLS denies by default.

CREATE TABLE public.market_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet text NOT NULL,
  question text NOT NULL,
  category text NOT NULL,
  short_reason text NOT NULL,
  topics text[] NOT NULL DEFAULT '{}',
  source_category text NOT NULL,
  secondary_category text,
  score numeric,
  status text NOT NULL DEFAULT 'ready',
  created_market_id bigint,
  final_question text,
  engine_version integer NOT NULL DEFAULT 1,
  generated_at timestamptz NOT NULL DEFAULT now(),
  shown_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '7 days',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_suggestions_status_chk
    CHECK (status IN ('ready','shown','dismissed','editing','created','expired'))
);

CREATE INDEX market_suggestions_wallet_status_idx
  ON public.market_suggestions (wallet, status, expires_at DESC);
CREATE INDEX market_suggestions_wallet_recent_idx
  ON public.market_suggestions (wallet, generated_at DESC);

GRANT ALL ON public.market_suggestions TO service_role;
ALTER TABLE public.market_suggestions ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER market_suggestions_touch
  BEFORE UPDATE ON public.market_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Funnel analytics: generated → shown → create/edit/dismiss → published.
CREATE TABLE public.market_suggestion_events (
  id bigserial PRIMARY KEY,
  suggestion_id uuid REFERENCES public.market_suggestions(id) ON DELETE CASCADE,
  wallet text,
  type text NOT NULL,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  ts timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX market_suggestion_events_type_ts_idx
  ON public.market_suggestion_events (type, ts DESC);
CREATE INDEX market_suggestion_events_suggestion_idx
  ON public.market_suggestion_events (suggestion_id, ts DESC);

GRANT ALL ON public.market_suggestion_events TO service_role;
ALTER TABLE public.market_suggestion_events ENABLE ROW LEVEL SECURITY;