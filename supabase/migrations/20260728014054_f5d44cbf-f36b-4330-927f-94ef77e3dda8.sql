ALTER TABLE public.wallet_beliefs
  ADD COLUMN IF NOT EXISTS yes_value_usd numeric,
  ADD COLUMN IF NOT EXISTS no_value_usd numeric,
  ADD COLUMN IF NOT EXISTS value_source text,
  ADD COLUMN IF NOT EXISTS value_updated_at timestamptz;