-- ============================================================================
-- Expressed beliefs — a FREE belief layer that feeds Conviction DNA + the House.
--
-- A viewer can express a belief (YES/NO) on a market without putting money down
-- (a "belief tap"). These feed the same DNA / Network / House machinery as
-- on-chain positions, but at a LOW fixed weight so money-backed conviction always
-- dominates. This is what lets calibration populate the Network for a new user.
--
-- One expressed belief per (wallet, market); an on-chain position on the same
-- market always overrides the free one (handled at read time via NOT EXISTS).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.expressed_beliefs (
  wallet      text NOT NULL,
  onchain_id  bigint NOT NULL,
  side        text NOT NULL CHECK (side IN ('YES','NO')),
  weight      numeric NOT NULL DEFAULT 0.15,   -- low vs on-chain conviction (0..1)
  source      text NOT NULL DEFAULT 'tap',      -- 'tap' | 'calibration'
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet, onchain_id)
);
CREATE INDEX IF NOT EXISTS expressed_beliefs_market_idx
  ON public.expressed_beliefs (onchain_id, side);
GRANT SELECT ON public.expressed_beliefs TO anon, authenticated;
GRANT ALL ON public.expressed_beliefs TO service_role;
ALTER TABLE public.expressed_beliefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY expressed_beliefs_public_read ON public.expressed_beliefs
  FOR SELECT TO anon, authenticated USING (true);

-- ── Candidate generation reads on-chain + expressed together ─────────────────
-- Rewritten to source from a unified CTE. When expressed_beliefs is empty the
-- UNION contributes nothing, so behavior is identical to before — safe to apply
-- ahead of any expressed data existing.
CREATE OR REPLACE FUNCTION public.find_match_candidates(
  p_viewer         text,
  p_min_shared     int DEFAULT 5,
  p_max_candidates int DEFAULT 500
)
RETURNS TABLE (
  wallet                  text,
  shared_markets          int,
  same_side               int,
  opposite_side           int,
  weighted_evidence       numeric,
  last_shared_activity_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH beliefs AS (
    SELECT wallet, onchain_id, stance_side, GREATEST(conviction, 0) AS conviction, last_trade_at
    FROM public.wallet_beliefs
    WHERE stance_side IN ('YES','NO')
    UNION ALL
    SELECT eb.wallet, eb.onchain_id, eb.side AS stance_side,
           GREATEST(eb.weight, 0) AS conviction, eb.updated_at AS last_trade_at
    FROM public.expressed_beliefs eb
    WHERE NOT EXISTS (
      SELECT 1 FROM public.wallet_beliefs wb2
      WHERE wb2.wallet = eb.wallet AND wb2.onchain_id = eb.onchain_id
        AND wb2.stance_side IN ('YES','NO')
    )
  ),
  viewer AS (
    SELECT onchain_id, stance_side, conviction
    FROM beliefs
    WHERE wallet = lower(p_viewer)
  ),
  pop AS (
    SELECT b.onchain_id, count(*)::numeric AS participants
    FROM beliefs b
    JOIN viewer v ON v.onchain_id = b.onchain_id
    GROUP BY b.onchain_id
  ),
  cand AS (
    SELECT
      b.wallet,
      (b.stance_side = v.stance_side) AS same,
      sqrt(v.conviction * GREATEST(b.conviction, 0))
        * (1.0 / log(2.0, 2 + COALESCE(p.participants, 0))) AS ev,
      b.last_trade_at
    FROM beliefs b
    JOIN viewer v ON v.onchain_id = b.onchain_id
    LEFT JOIN pop p ON p.onchain_id = b.onchain_id
    WHERE b.wallet <> lower(p_viewer)
      AND NOT EXISTS (SELECT 1 FROM public.wallet_denylist d WHERE d.wallet = b.wallet)
  )
  SELECT
    wallet,
    count(*)::int AS shared_markets,
    count(*) FILTER (WHERE same)::int AS same_side,
    count(*) FILTER (WHERE NOT same)::int AS opposite_side,
    sum(ev) AS weighted_evidence,
    max(last_trade_at) AS last_shared_activity_at
  FROM cand
  GROUP BY wallet
  HAVING count(*) >= p_min_shared
  ORDER BY sum(ev) DESC, count(*) DESC, wallet ASC
  LIMIT p_max_candidates
$$;
GRANT EXECUTE ON FUNCTION public.find_match_candidates(text, int, int)
  TO anon, authenticated, service_role;
