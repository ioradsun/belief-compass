-- ============================================================================
-- calc_cache — let the app read the number it depends on.
--
-- THE BUG THIS FIXES. `calc_cache` holds public derived values, of which the
-- ETH/USD calibration is the one the whole live feed rests on. It was created
-- with RLS ENABLED and a grant to `service_role` only — no anon grant, no SELECT
-- policy. But `listLiveEvents` reads it through the PUBLIC client:
--
--     const { data: cal } = await sb.from("calc_cache")...   // anon
--     const ethUsd = Number(cal?.value ?? 0) || 0;           // → 0, always
--
-- Under RLS a role with no policy does not get an error. It gets HTTP 200 and
-- zero rows. So the read silently returned null, the rate silently became 0,
-- every trade was priced at $0, and every $0 trade was discarded as dust. The
-- live tape rendered two structural rows on top of thousands of real trades.
--
-- The value could have been perfectly correct the entire time — and it was
-- irrelevant, because the feed was never able to see it. Refreshing the
-- calibration would not have fixed anything.
--
-- WHY THIS IS SAFE. The table holds one derived market-wide number: the average
-- USD per ETH implied by our own trade history. It is not user data, not
-- viewer-relative, and it is already visible in every price the app renders.
-- Reading it is exactly as public as the markets it describes.
--
-- Writes stay restricted to service_role and to the SECURITY DEFINER refresher.
-- ============================================================================

GRANT SELECT ON public.calc_cache TO anon, authenticated;

DROP POLICY IF EXISTS calc_cache_public_read ON public.calc_cache;
CREATE POLICY calc_cache_public_read ON public.calc_cache
  FOR SELECT TO anon, authenticated USING (true);

-- Populate it now, so the first read after this migration has a value rather
-- than waiting up to ten minutes for the cron. Returns NULL harmlessly when no
-- market has volume_total_usd > 0 yet; the app treats a missing rate as an
-- unknown AMOUNT rather than as zero (see src/lib/live-tape).
SELECT public.refresh_eth_usd_calibration();
