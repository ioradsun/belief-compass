UPDATE public.markets m
SET title = c.question,
    category = COALESCE(m.category, c.category),
    author_wallet = COALESCE(m.author_wallet, c.creator_wallet),
    source = 'conviction',
    created_at = COALESCE(m.created_at, c.created_at)
FROM public.conviction_markets c
WHERE c.onchain_id = m.onchain_id
  AND m.title IS NULL;

SELECT public.enqueue_market_refresh(
  ARRAY(SELECT onchain_id FROM public.conviction_markets WHERE onchain_id IS NOT NULL)::bigint[],
  'activity'
);