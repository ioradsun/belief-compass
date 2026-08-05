drop policy if exists "events_live_trades_read" on public.events;
revoke select on public.events from anon, authenticated;

drop policy if exists "welcomes_public_read" on public.welcomes;
revoke select on public.welcomes from anon, authenticated;

revoke select on public.profiles from anon, authenticated;
grant select (wallet, username, display_name, pfp_url, not_found, fetched_at)
  on public.profiles to anon, authenticated;