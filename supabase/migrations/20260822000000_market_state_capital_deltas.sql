-- Per-side 24h capital delta on the canonical read-model.
--
-- The center and side panels derive per-side capital change from the client tape
-- (marketBook). The universal-feed transition emitter runs server-side off
-- market_state and had no capital delta, so the strongest stories — "More
-- believers. Less capital.", "Capital is concentrating on YES." — could never
-- reach the feed. This surfaces the delta onto the SAME market_state row, derived
-- during refresh from the authoritative market_state_snapshots baseline (the
-- window-open capital ~24h ago) minus the current capital — never recomputed from
-- the browser tape. NULL when no old-enough snapshot exists (missing/stale history
-- is never treated as a dramatic zero).

ALTER TABLE public.market_state
  ADD COLUMN IF NOT EXISTS yes_capital_delta_24h numeric,
  ADD COLUMN IF NOT EXISTS no_capital_delta_24h  numeric;
