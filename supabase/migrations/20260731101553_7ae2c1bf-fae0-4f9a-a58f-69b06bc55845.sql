REVOKE EXECUTE ON FUNCTION public.detect_believer_milestones() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.detect_tribe_doublings() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.detect_believer_milestones() TO service_role;
GRANT EXECUTE ON FUNCTION public.detect_tribe_doublings() TO service_role;