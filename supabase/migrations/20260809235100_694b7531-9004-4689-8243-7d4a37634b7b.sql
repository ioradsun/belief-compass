CREATE INDEX IF NOT EXISTS market_state_snapshots_captured_at_idx
  ON public.market_state_snapshots USING btree (captured_at);

CREATE INDEX IF NOT EXISTS events_live_kinds_recency_idx
  ON public.events USING btree (occurred_at DESC, block_number DESC, log_index DESC)
  WHERE is_canonical = true
    AND kind IN ('trade','market_created','position_changed_side','believer_milestone','tribe_doubled','market_transition','conviction_cohort');