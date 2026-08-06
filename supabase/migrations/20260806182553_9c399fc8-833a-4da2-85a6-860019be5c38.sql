GRANT SELECT ON public.events TO anon, authenticated;
GRANT ALL ON public.events TO service_role;

CREATE POLICY "Public can read canonical activity"
ON public.events FOR SELECT
TO anon, authenticated
USING (is_canonical);