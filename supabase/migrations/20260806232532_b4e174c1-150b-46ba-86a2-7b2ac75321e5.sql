alter table public.market_state
  add column if not exists capital_usd numeric
  generated always as (coalesce(yes_capital_usd, 0) + coalesce(no_capital_usd, 0)) stored;

comment on column public.market_state.capital_usd is
  'Whole-market capital committed right now, USD: yes_capital_usd + no_capital_usd. Generated — never written directly. Ordering key for the Explore "Most Capital" lens candidate slice.';

create index if not exists market_state_capital_usd_desc_idx
  on public.market_state (capital_usd desc nulls last);