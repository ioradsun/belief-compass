-- Per-side capital + 24h volume for the feed's Price / People / Capital view.
-- Money moves the price; people reveal conviction; capital shows how strongly.
-- Seeing believer-count and capital DISAGREE (broad vs concentrated conviction)
-- is the story — but it needs per-side capital, not just the money-weighted %.
ALTER TABLE public.market_state
  ADD COLUMN IF NOT EXISTS yes_capital_usd numeric,  -- YES-side market cap (backing)
  ADD COLUMN IF NOT EXISTS no_capital_usd  numeric,  -- NO-side market cap (backing)
  ADD COLUMN IF NOT EXISTS volume_24h_usd  numeric;  -- 24h volume → buying pressure
