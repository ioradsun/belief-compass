UPDATE public.market_refresh_queue q
SET requested_at = '1970-01-01T00:00:00Z'
WHERE q.market_id IN (
  SELECT c.onchain_id FROM public.conviction_markets c
  LEFT JOIN public.market_state s ON s.onchain_id = c.onchain_id
  WHERE c.onchain_id IS NOT NULL AND s.onchain_id IS NULL
);