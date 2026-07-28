CREATE INDEX IF NOT EXISTS ms_volume_total_idx
  ON public.market_state (volume_total_usd DESC NULLS LAST, onchain_id);