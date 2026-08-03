CREATE TABLE public.market_ai_analysis (
  onchain_id bigint PRIMARY KEY,
  content_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  engine_version integer NOT NULL DEFAULT 1,
  analyzed_at timestamptz,
  category text,
  subcategory text,
  topic text,
  summary text,
  audience text,
  related_topics text[] NOT NULL DEFAULT '{}',
  clarity_score numeric,
  answerability_score numeric,
  novelty_score numeric,
  debate_score numeric,
  identity_score numeric,
  time_sensitivity numeric,
  media_relevance numeric,
  quality_score numeric,
  risk_flags text[] NOT NULL DEFAULT '{}',
  embedding jsonb,
  duplicate_cluster_id text,
  duplicate_similarity numeric,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX market_ai_analysis_status_idx ON public.market_ai_analysis (status, updated_at);
CREATE INDEX market_ai_analysis_cluster_idx ON public.market_ai_analysis (duplicate_cluster_id);
GRANT ALL ON public.market_ai_analysis TO service_role;
ALTER TABLE public.market_ai_analysis ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.viewer_market_events (
  viewer_wallet text NOT NULL,
  market_id bigint NOT NULL,
  kind text NOT NULL,
  count integer NOT NULL DEFAULT 1,
  last_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (viewer_wallet, market_id, kind),
  CONSTRAINT viewer_market_events_kind_check CHECK (kind IN ('view','open','pass','hide','sold'))
);
CREATE INDEX viewer_market_events_wallet_idx ON public.viewer_market_events (viewer_wallet, last_at DESC);
GRANT ALL ON public.viewer_market_events TO service_role;
ALTER TABLE public.viewer_market_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.record_viewer_market_event(p_wallet text, p_market bigint, p_kind text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO public.viewer_market_events (viewer_wallet, market_id, kind, count, last_at)
  VALUES (lower(p_wallet), p_market, p_kind, 1, now())
  ON CONFLICT (viewer_wallet, market_id, kind)
  DO UPDATE SET count = public.viewer_market_events.count + 1, last_at = now();
$$;
REVOKE EXECUTE ON FUNCTION public.record_viewer_market_event(text, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_viewer_market_event(text, bigint, text) TO service_role;