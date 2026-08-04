GRANT SELECT ON public.calc_cache TO anon, authenticated;

DROP POLICY IF EXISTS calc_cache_public_read ON public.calc_cache;
CREATE POLICY calc_cache_public_read ON public.calc_cache
  FOR SELECT TO anon, authenticated USING (true);

SELECT public.refresh_eth_usd_calibration();