drop policy if exists profiles_public_read on public.profiles;
revoke all on public.profiles from anon, authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;