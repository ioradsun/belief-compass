
-- markets: category provenance
ALTER TABLE public.markets
  ADD COLUMN IF NOT EXISTS category_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS category_source text NOT NULL DEFAULT 'unknown';

UPDATE public.markets
SET category_source = CASE WHEN category IS NULL OR category = '' THEN 'unknown' ELSE 'pov' END
WHERE category_source = 'unknown';

-- wallet_matches: add domain dimension. NULL domain = overall Tribe.
ALTER TABLE public.wallet_matches
  ADD COLUMN IF NOT EXISTS domain text;

-- Replace PK (wallet, matched_wallet) with a unique key that includes domain.
ALTER TABLE public.wallet_matches DROP CONSTRAINT IF EXISTS wallet_matches_pkey;

-- Partial unique indexes so NULL domain (overall) uniquely maps a matched wallet,
-- and each non-NULL domain uniquely maps a matched wallet.
CREATE UNIQUE INDEX IF NOT EXISTS wm_overall_uniq
  ON public.wallet_matches (wallet, matched_wallet)
  WHERE domain IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS wm_domain_uniq
  ON public.wallet_matches (wallet, matched_wallet, domain)
  WHERE domain IS NOT NULL;

CREATE INDEX IF NOT EXISTS wm_wallet_domain_score_idx
  ON public.wallet_matches (wallet, domain, match_score DESC);
