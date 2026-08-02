REVOKE ALL ON FUNCTION public.conviction_attributed_value(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conviction_ecosystem_share(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.conviction_attributed_value(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.conviction_ecosystem_share(integer) TO service_role;