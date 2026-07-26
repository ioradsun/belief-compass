ALTER TABLE public.market_state
  ADD COLUMN IF NOT EXISTS yes_capital_usd numeric,
  ADD COLUMN IF NOT EXISTS no_capital_usd  numeric,
  ADD COLUMN IF NOT EXISTS volume_24h_usd  numeric;

-- Seed 24h volume from trades (ETH amount as a proxy until USD-priced trades land)
UPDATE public.market_state ms
SET volume_24h_usd = COALESCE(v.vol, 0)
FROM (
  SELECT onchain_id, SUM(eth_amount)::numeric AS vol
  FROM public.trades
  WHERE ts >= now() - interval '24 hours'
  GROUP BY onchain_id
) v
WHERE v.onchain_id = ms.onchain_id;