REVOKE ALL ON FUNCTION public.ingest_chain_chunk(jsonb, jsonb, bigint, bigint, bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ingest_chain_chunk(jsonb, jsonb, bigint, bigint, bigint) TO service_role;
REVOKE ALL ON FUNCTION public.bump_wallet_match_version() FROM PUBLIC, anon, authenticated;