DROP POLICY IF EXISTS is_service_only ON public.ingest_state;

CREATE POLICY ingest_state_public_read
  ON public.ingest_state
  FOR SELECT
  TO anon, authenticated
  USING (true);

GRANT SELECT ON public.ingest_state TO anon, authenticated;