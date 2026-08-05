create or replace function public.market_participation()
returns table(onchain_id bigint, participants integer, first_activity_at timestamptz, last_activity_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select (e.market_id)::bigint,
         count(distinct e.wallet)::int,
         min(e.occurred_at),
         max(e.occurred_at)
  from public.events e
  where e.is_canonical
    and e.wallet is not null
    and e.market_id ~ '^[0-9]+$'
  group by e.market_id
$$;

revoke all on function public.market_participation() from public;
revoke all on function public.market_participation() from anon;
revoke all on function public.market_participation() from authenticated;
grant execute on function public.market_participation() to service_role;