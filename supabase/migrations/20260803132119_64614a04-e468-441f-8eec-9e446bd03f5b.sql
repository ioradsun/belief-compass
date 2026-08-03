CREATE OR REPLACE FUNCTION public.record_viewer_market_event(p_wallet text, p_market bigint, p_kind text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_kind NOT IN ('view','open','pass','hide','sold') THEN
    RAISE EXCEPTION 'invalid kind %', p_kind;
  END IF;
  INSERT INTO public.viewer_market_events (viewer_wallet, market_id, kind, count, last_at)
  VALUES (lower(p_wallet), p_market, p_kind, 1, now())
  ON CONFLICT (viewer_wallet, market_id, kind)
  DO UPDATE SET count = public.viewer_market_events.count + 1, last_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.record_viewer_market_event(text, bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_viewer_market_event(text, bigint, text) TO service_role;