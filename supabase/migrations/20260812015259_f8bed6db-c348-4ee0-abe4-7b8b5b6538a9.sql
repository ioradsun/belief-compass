-- A verified purchase always beats a recorded walk-away: repair rounds that were
-- closed as PASS even though the wallet is holding a side on that market.
update public.house_predictions hp
set actual_action = case when wb.yes_shares > 0 then 'YES' else 'NO' end,
    actual_side  = case when wb.yes_shares > 0 then 'YES' else 'NO' end,
    finalized_via = 'bet',
    revealed_at = coalesce(hp.revealed_at, now()),
    outcome = case
      when hp.predicted_action is null then 'unscored'
      when hp.predicted_action = (case when wb.yes_shares > 0 then 'YES' else 'NO' end) then 'correct'
      else 'miss' end
from public.wallet_beliefs wb
where wb.wallet = hp.wallet
  and wb.onchain_id = hp.onchain_id
  and hp.actual_action = 'PASS'
  and (wb.yes_shares > 0 or wb.no_shares > 0)
  and wb.last_trade_at is not null;