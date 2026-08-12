REVOKE EXECUTE ON FUNCTION public.refresh_price_path_hourly(integer) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_price_path_hourly(integer) TO service_role;