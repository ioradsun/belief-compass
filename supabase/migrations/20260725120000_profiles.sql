-- POV identity cache. Wallet → profile (display name + pfp) resolved from the
-- pov.co API. Populated for free from market authors by Job A (pov-poller) and
-- lazily for other shown wallets by the feed. `not_found` marks wallets with no
-- POV account so we don't re-fetch them every time.
CREATE TABLE public.profiles (
  wallet       text PRIMARY KEY,
  username     text,
  display_name text,
  pfp_url      text,
  twitter_id   text,
  not_found    boolean NOT NULL DEFAULT false,
  fetched_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.profiles TO anon, authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_public_read ON public.profiles
  FOR SELECT TO anon, authenticated USING (true);
