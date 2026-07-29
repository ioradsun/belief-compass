-- 1. Remove public read on per-wallet derived conviction data
DROP POLICY IF EXISTS "expressed_beliefs_public_read" ON public.expressed_beliefs;
DROP POLICY IF EXISTS "vdc_public_read" ON public.viewer_dna_cache;

REVOKE ALL ON public.expressed_beliefs FROM anon, authenticated;
REVOKE ALL ON public.viewer_dna_cache FROM anon, authenticated;
GRANT ALL ON public.expressed_beliefs TO service_role;
GRANT ALL ON public.viewer_dna_cache TO service_role;

-- 2. SECURITY DEFINER functions must never be callable from the browser
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f.sig);
  END LOOP;
END $$;