delete from public.events e
using public.market_state ms
where ms.onchain_id::text = e.market_id
  and e.payload->>'type' = 'accelerating'
  and coalesce(ms.trade_count_1h, 0) = 0;

delete from public.market_transition_state ts
using public.market_state ms
where ms.onchain_id = ts.onchain_id
  and ts.fingerprint like 'accelerating:%'
  and coalesce(ms.trade_count_1h, 0) = 0;