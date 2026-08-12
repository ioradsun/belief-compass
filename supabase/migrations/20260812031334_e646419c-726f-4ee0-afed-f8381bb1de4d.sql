DO $$
DECLARE
  v_eth_usd numeric;
  v_yes_eth numeric;
  v_no_eth numeric;
  v_yes_count integer;
  v_no_count integer;
BEGIN
  SELECT public.eth_usd_calibration() INTO v_eth_usd;

  SELECT
    COALESCE(sum(yes_cost), 0),
    COALESCE(sum(no_cost), 0),
    count(*) FILTER (WHERE expressed_side = 'YES' AND yes_shares > 0),
    count(*) FILTER (WHERE expressed_side = 'NO' AND no_shares > 0)
  INTO v_yes_eth, v_no_eth, v_yes_count, v_no_count
  FROM public.wallet_beliefs
  WHERE onchain_id = 2828
    AND NOT EXISTS (
      SELECT 1 FROM public.wallet_denylist d
      WHERE d.wallet = wallet_beliefs.wallet
    );

  UPDATE public.market_state
  SET yes_capital_usd = v_yes_eth * v_eth_usd,
      no_capital_usd = v_no_eth * v_eth_usd,
      capital_held_yes = v_yes_eth,
      capital_held_no = v_no_eth,
      capital_held_total = v_yes_eth + v_no_eth,
      believers_yes = GREATEST(v_yes_count, CASE WHEN v_yes_eth > 0 THEN 1 ELSE 0 END),
      believers_no = GREATEST(v_no_count, CASE WHEN v_no_eth > 0 THEN 1 ELSE 0 END),
      directional_believers = GREATEST(v_yes_count, CASE WHEN v_yes_eth > 0 THEN 1 ELSE 0 END)
        + GREATEST(v_no_count, CASE WHEN v_no_eth > 0 THEN 1 ELSE 0 END),
      active_positions = v_yes_count + v_no_count,
      money_yes_pct = CASE
        WHEN v_yes_eth + v_no_eth > 0 THEN v_yes_eth / (v_yes_eth + v_no_eth) * 100
        ELSE NULL
      END,
      updated_at = now(),
      calculated_at = now()
  WHERE onchain_id = 2828;

  PERFORM public.enqueue_market_refresh(ARRAY[2828]::bigint[], 'positions');
END
$$;