CREATE TABLE public.profile_overrides (
  wallet text PRIMARY KEY,
  display_name text,
  avatar_url text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.profile_overrides TO anon;
GRANT SELECT ON public.profile_overrides TO authenticated;
GRANT ALL ON public.profile_overrides TO service_role;

ALTER TABLE public.profile_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profile_overrides_public_read"
  ON public.profile_overrides FOR SELECT
  TO anon, authenticated
  USING (true);