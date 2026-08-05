-- Mark the activity that moved money without moving a belief.
--
-- The live tape has always dropped washes and churn. The METRICS did not, so a
-- market could show volume spiking on the scoreboard while the tape said
-- nothing — and a reader with two numbers that disagree cannot tell which one
-- to believe. This closes that gap by recording the verdict ONCE, on the event,
-- so the feed and every aggregate read the same fact.
--
-- The judgement itself stays in TypeScript (src/domain/wash-trading.ts) and is
-- written here by a job. Re-implementing the heuristic in SQL would put a
-- second copy of one rule in a second language, which is exactly the failure
-- that left four surfaces reading a column nobody wrote.
--
-- NOTE ON MEANING. `is_wash` answers one narrow question — did this express
-- conviction? — and nothing else may be inferred from it. A market maker
-- quoting both sides is doing something legitimate and is still flagged,
-- correctly: their activity is real, and it is still not a belief.
ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS is_wash boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS wash_reason text;

COMMENT ON COLUMN public.events.is_wash IS
  'Expressed no belief (round trip or balanced churn). Excluded from the feed and from every activity aggregate. Says nothing about intent.';

-- Every aggregate filters on this alongside is_canonical, so it belongs in the
-- same partial-index shape the trade windows already use.
CREATE INDEX IF NOT EXISTS events_market_real_idx
  ON public.events (market_id, occurred_at DESC)
  WHERE is_canonical = true AND is_wash = false;

-- The marker's own scan: recent trades, oldest-first within a window.
CREATE INDEX IF NOT EXISTS events_trade_recent_idx
  ON public.events (occurred_at DESC)
  WHERE is_canonical = true AND kind = 'trade';

-- ── The aggregates now agree with the feed ──────────────────────────────────
-- Redefined verbatim from 20260801000000_market_read_model.sql with one added
-- predicate, so a future edit to the metrics has exactly one place to land.
CREATE OR REPLACE FUNCTION public.market_event_windows(p_market bigint, p_now timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$
  WITH e AS (
    SELECT action, occurred_at, wallet, (amount_eth / 1e18) AS eth
    FROM events
    WHERE market_id = p_market::text AND is_canonical = true AND kind = 'trade'
      -- Washes and churn are excluded from every activity metric, exactly as
      -- the live tape excludes them. A scoreboard that disagrees with the feed
      -- makes a reader distrust both.
      AND is_wash = false
  )
  SELECT jsonb_build_object(
    'trade_count_1h',  count(*) FILTER (WHERE occurred_at >= p_now - interval '1 hour'),
    'trade_count_24h', count(*) FILTER (WHERE occurred_at >= p_now - interval '24 hours'),
    'trade_count_7d',  count(*) FILTER (WHERE occurred_at >= p_now - interval '7 days'),
    'buy_count_1h',    count(*) FILTER (WHERE action='BUY'  AND occurred_at >= p_now - interval '1 hour'),
    'buy_count_24h',   count(*) FILTER (WHERE action='BUY'  AND occurred_at >= p_now - interval '24 hours'),
    'sell_count_1h',   count(*) FILTER (WHERE action='SELL' AND occurred_at >= p_now - interval '1 hour'),
    'sell_count_24h',  count(*) FILTER (WHERE action='SELL' AND occurred_at >= p_now - interval '24 hours'),
    'volume_eth_1h',   COALESCE(sum(eth) FILTER (WHERE occurred_at >= p_now - interval '1 hour'), 0),
    'volume_eth_24h',  COALESCE(sum(eth) FILTER (WHERE occurred_at >= p_now - interval '24 hours'), 0),
    'volume_eth_7d',   COALESCE(sum(eth) FILTER (WHERE occurred_at >= p_now - interval '7 days'), 0),
    'unique_wallets_1h',  count(DISTINCT wallet) FILTER (WHERE occurred_at >= p_now - interval '1 hour'),
    'unique_wallets_24h', count(DISTINCT wallet) FILTER (WHERE occurred_at >= p_now - interval '24 hours'),
    'unique_wallets_7d',  count(DISTINCT wallet) FILTER (WHERE occurred_at >= p_now - interval '7 days'),
    'first_trade_at', min(occurred_at),
    'last_trade_at',  max(occurred_at),
    'total_trades',   count(*)
  ) FROM e;
$$;

GRANT EXECUTE ON FUNCTION public.market_event_windows(bigint, timestamptz)
  TO anon, authenticated, service_role;
