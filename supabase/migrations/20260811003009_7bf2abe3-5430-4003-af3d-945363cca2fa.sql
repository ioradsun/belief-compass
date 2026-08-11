REVOKE ALL ON FUNCTION public.put_on_table(text, bigint, bigint, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.put_on_table(text, bigint, bigint, jsonb) TO service_role;