revoke all on public.conviction_trades from anon, authenticated;
revoke all on public.market_ai_analysis from anon, authenticated;
revoke all on public.wallet_beliefs from anon, authenticated;

grant all on public.conviction_trades to service_role;
grant all on public.market_ai_analysis to service_role;
grant all on public.wallet_beliefs to service_role;

alter table public.conviction_trades enable row level security;
alter table public.market_ai_analysis enable row level security;
alter table public.wallet_beliefs enable row level security;

comment on table public.wallet_beliefs is 'Per-wallet position state. Server-only: no anon/authenticated grants and no RLS policies (fail-closed). Reads go through server functions.';