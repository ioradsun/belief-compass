
-- Extensions for cron + outbound http (used by cron sql to hit our /api/public/jobs routes)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ============================================================
-- markets: canonical POV metadata (one row per on-chain market)
-- ============================================================
CREATE TABLE public.markets (
  onchain_id      bigint PRIMARY KEY,
  pov_uuid        uuid,
  title           text,
  category        text,
  author_wallet   text,
  author_name     text,
  author_pfp      text,
  agent_opinions  jsonb,
  source          text NOT NULL DEFAULT 'pov',
  our_metadata    jsonb,
  created_at      timestamptz,
  first_seen      timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.markets TO anon, authenticated;
GRANT ALL ON public.markets TO service_role;
ALTER TABLE public.markets ENABLE ROW LEVEL SECURITY;
CREATE POLICY markets_public_read ON public.markets FOR SELECT TO anon, authenticated USING (true);

-- ============================================================
-- trades: canonical on-chain trade log (idempotent per tx+log)
-- ============================================================
CREATE TABLE public.trades (
  tx_hash      text NOT NULL,
  log_index    int  NOT NULL,
  onchain_id   bigint NOT NULL,
  wallet       text NOT NULL,
  side         text NOT NULL CHECK (side IN ('YES','NO')),
  direction    text NOT NULL CHECK (direction IN ('BUY','SELL')),
  eth_amount   numeric NOT NULL,
  token_amount numeric NOT NULL,
  block_number bigint NOT NULL,
  block_hash   text NOT NULL,
  raw_log      jsonb,
  ts           timestamptz NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX trades_market_ts_idx ON public.trades (onchain_id, ts DESC);
CREATE INDEX trades_wallet_ts_idx ON public.trades (wallet, ts DESC);
CREATE INDEX trades_block_idx ON public.trades (block_number);
GRANT SELECT ON public.trades TO anon, authenticated;
GRANT ALL ON public.trades TO service_role;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY trades_public_read ON public.trades FOR SELECT TO anon, authenticated USING (true);

-- ============================================================
-- wallet_beliefs: THE core intelligence table (per wallet, per market)
--   trade-derived cols (applyTrade): yes/no shares & cost, expressed_side, directional_since
--   price-derived cols (evaluate): stance, stance_side, conviction, days_held
-- ============================================================
CREATE TABLE public.wallet_beliefs (
  wallet            text NOT NULL,
  onchain_id        bigint NOT NULL,
  yes_shares        numeric NOT NULL DEFAULT 0,
  no_shares         numeric NOT NULL DEFAULT 0,
  yes_cost          numeric NOT NULL DEFAULT 0,
  no_cost           numeric NOT NULL DEFAULT 0,
  expressed_side    text NOT NULL DEFAULT 'INACTIVE'
                    CHECK (expressed_side IN ('YES','NO','MIXED','INACTIVE')),
  stance            numeric,
  stance_side       text CHECK (stance_side IN ('YES','NO','MIXED','INACTIVE')),
  conviction        numeric NOT NULL DEFAULT 0,
  directional_since timestamptz,
  days_held         numeric NOT NULL DEFAULT 0,
  first_backed_at   timestamptz,
  last_trade_at     timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet, onchain_id)
);
CREATE INDEX wb_market_stance_idx ON public.wallet_beliefs (onchain_id, stance_side);
CREATE INDEX wb_wallet_stance_idx ON public.wallet_beliefs (wallet, stance_side);
GRANT SELECT ON public.wallet_beliefs TO anon, authenticated;
GRANT ALL ON public.wallet_beliefs TO service_role;
ALTER TABLE public.wallet_beliefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY wb_public_read ON public.wallet_beliefs FOR SELECT TO anon, authenticated USING (true);

-- ============================================================
-- market_state: what the feed reads; rebuilt by Job A (POV) + Job C (chain rollup)
-- ============================================================
CREATE TABLE public.market_state (
  onchain_id        bigint PRIMARY KEY REFERENCES public.markets(onchain_id) ON DELETE CASCADE,
  yes_price_usd     numeric,
  no_price_usd      numeric,
  money_yes_pct     numeric,     -- = POV yesPercentage
  believers_yes     int NOT NULL DEFAULT 0,
  believers_no      int NOT NULL DEFAULT 0,
  believers_mixed   int NOT NULL DEFAULT 0,
  people_yes_pct    numeric,     -- believers_yes / (yes + no)
  divergence        numeric,     -- abs(money_yes_pct - people_yes_pct)
  volume_total_usd  numeric,
  boost_score       numeric,
  trending_score    numeric,
  chg_1h            numeric,
  chg_24h           numeric,
  velocity_5m       int NOT NULL DEFAULT 0,
  new_believers_1h  int NOT NULL DEFAULT 0,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.market_state TO anon, authenticated;
GRANT ALL ON public.market_state TO service_role;
ALTER TABLE public.market_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY ms_public_read ON public.market_state FOR SELECT TO anon, authenticated USING (true);
ALTER PUBLICATION supabase_realtime ADD TABLE public.market_state;

-- ============================================================
-- price_snapshots: rolling POV price/pct history for chg_1h/24h
-- ============================================================
CREATE TABLE public.price_snapshots (
  onchain_id     bigint NOT NULL,
  captured_at    timestamptz NOT NULL DEFAULT now(),
  yes_price_usd  numeric,
  money_yes_pct  numeric,
  PRIMARY KEY (onchain_id, captured_at)
);
GRANT SELECT ON public.price_snapshots TO anon, authenticated;
GRANT ALL ON public.price_snapshots TO service_role;
ALTER TABLE public.price_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY ps_public_read ON public.price_snapshots FOR SELECT TO anon, authenticated USING (true);

-- ============================================================
-- feed_events: story layer. Only trade-driven transitions emit here.
-- ============================================================
CREATE TABLE public.feed_events (
  id          bigserial PRIMARY KEY,
  event_key   text UNIQUE NOT NULL,
  onchain_id  bigint,
  wallet      text,
  type        text NOT NULL,
  side        text,
  payload     jsonb,
  occurred_at timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX fe_created_idx ON public.feed_events (created_at DESC);
CREATE INDEX fe_market_idx ON public.feed_events (onchain_id, occurred_at DESC);
CREATE INDEX fe_wallet_idx ON public.feed_events (wallet, occurred_at DESC);
GRANT SELECT ON public.feed_events TO anon, authenticated;
GRANT ALL ON public.feed_events TO service_role;
ALTER TABLE public.feed_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY fe_public_read ON public.feed_events FOR SELECT TO anon, authenticated USING (true);
ALTER PUBLICATION supabase_realtime ADD TABLE public.feed_events;

-- ============================================================
-- wallet_matches: DNA matches, computed lazily per wallet on view
-- ============================================================
CREATE TABLE public.wallet_matches (
  wallet          text NOT NULL,
  matched_wallet  text NOT NULL,
  match_score     numeric NOT NULL,
  shared_markets  int NOT NULL,
  agreements      int NOT NULL,
  disagreements   int NOT NULL,
  calculated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet, matched_wallet)
);
CREATE INDEX wm_wallet_score_idx ON public.wallet_matches (wallet, match_score DESC);
GRANT SELECT ON public.wallet_matches TO anon, authenticated;
GRANT ALL ON public.wallet_matches TO service_role;
ALTER TABLE public.wallet_matches ENABLE ROW LEVEL SECURITY;
CREATE POLICY wm_public_read ON public.wallet_matches FOR SELECT TO anon, authenticated USING (true);

-- ============================================================
-- ingest_state: single-row lease for Job B (chain poller)
-- ============================================================
CREATE TABLE public.ingest_state (
  id                int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_block        bigint,
  lease_owner       text,
  lease_expires_at  timestamptz
);
GRANT SELECT ON public.ingest_state TO authenticated;
GRANT ALL ON public.ingest_state TO service_role;
ALTER TABLE public.ingest_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY is_service_only ON public.ingest_state FOR SELECT TO authenticated USING (false);
INSERT INTO public.ingest_state (id, last_block) VALUES (1, NULL) ON CONFLICT DO NOTHING;

-- ============================================================
-- user_events: discovery-only interaction log. NEVER feeds DNA.
-- ============================================================
CREATE TABLE public.user_events (
  id          bigserial PRIMARY KEY,
  wallet      text,
  session_id  text,
  onchain_id  bigint,
  type        text NOT NULL,
  dwell_ms    int,
  ts          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ue_wallet_ts_idx ON public.user_events (wallet, ts DESC);
CREATE INDEX ue_market_ts_idx ON public.user_events (onchain_id, ts DESC);
GRANT INSERT ON public.user_events TO anon, authenticated;
GRANT SELECT ON public.user_events TO authenticated;
GRANT ALL ON public.user_events TO service_role;
ALTER TABLE public.user_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY ue_public_insert ON public.user_events FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY ue_service_read ON public.user_events FOR SELECT TO authenticated USING (false);

-- ============================================================
-- wallet_denylist: exclude known contracts/routers/treasuries from believer counts
-- ============================================================
CREATE TABLE public.wallet_denylist (
  wallet  text PRIMARY KEY,
  reason  text,
  added_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.wallet_denylist TO anon, authenticated;
GRANT ALL ON public.wallet_denylist TO service_role;
ALTER TABLE public.wallet_denylist ENABLE ROW LEVEL SECURITY;
CREATE POLICY wd_public_read ON public.wallet_denylist FOR SELECT TO anon, authenticated USING (true);
-- Seed with known infrastructure addresses from the spec
INSERT INTO public.wallet_denylist (wallet, reason) VALUES
  ('0xd4f4619bb4590598c778178690b77c589b93a3eb', 'proxy'),
  ('0xeec43ff91502d7715f02c55f1ab3deb02b6a488a', 'impl'),
  ('0x90178f03279e900885bed11adea6459673d0553d', 'belief-token-factory'),
  ('0xfb9a8a5f1ec4f505a9000e8998e009266e286dd4', 'boost')
ON CONFLICT DO NOTHING;
