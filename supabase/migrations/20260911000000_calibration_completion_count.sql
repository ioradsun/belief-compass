-- ─────────────────────────────────────────────────────────────────────────────
-- ONBOARDING COMPLETION IS LOCKED-10 CALIBRATION COMPLETION.
--
-- "How far through the first ten" — the onboarding goal, the Simulation
-- graduation gate, and the count `simulation_execute_order` flips GRADUATING on —
-- used to fold wallet_beliefs + expressed_beliefs and count DISTINCT markets
-- across the WHOLE platform. Ten unrelated convictions on any markets made
-- somebody "10 / 10" and graduated them to real money without ever meeting the
-- calibration, and it disagreed with the feed, which correctly treats the
-- decision ledger as the record of "answered".
--
-- The count is now restricted to the Locked 10 (onChainMarketId 2832–2841 — the
-- server-owned sequence in src/domain/calibration.ts), and it unions the decision
-- ledger so a PASS counts too: the product rule is that DECIDING a calibration
-- question in any way — yes, no or pass — is what advances completion.
--
-- WHY THREE SOURCES, AND WHY THE ATOMIC FLIP STILL HOLDS.
--   · expressed_beliefs      a Simulation order writes expressed_beliefs
--                            (source='simulation') for its market INSIDE
--                            simulation_execute_order and then recounts in the
--                            same transaction — so keeping it in the union is
--                            exactly what lets the tenth Locked conviction still
--                            flip GRADUATING atomically, with NO change to that
--                            function. It also carries a free calibration yes/no.
--   · wallet_beliefs         real, money-backed positions (and remembered ones).
--   · viewer_market_decisions the ONLY place a PASS lives — non-directional, so it
--                            is here and nowhere else. This is also the ledger the
--                            feed de-dups the Locked 10 by.
-- A market is one unit however many rows mention it: DISTINCT folds the three.
--
-- Readiness (the five-conviction Network unlock) is UNCHANGED and still counts
-- general belief across the platform — that number is evidence, not completion.
--
-- The Locked-10 range is duplicated here from src/domain/calibration.ts because a
-- SQL function cannot import it. These are POV market ids and do not change; if
-- the sequence ever does, both must move together — each carries a comment
-- pointing at the other.
CREATE OR REPLACE FUNCTION public.simulation_conviction_count(p_wallet text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT count(*)::integer FROM (
    SELECT onchain_id FROM wallet_beliefs
      WHERE wallet = lower(p_wallet)
        AND onchain_id BETWEEN 2832 AND 2841  -- the Locked 10; see src/domain/calibration.ts
        AND (stance_side IN ('YES','NO') OR last_directional_side IN ('YES','NO'))
    UNION
    SELECT onchain_id FROM expressed_beliefs
      WHERE wallet = lower(p_wallet)
        AND onchain_id BETWEEN 2832 AND 2841  -- the Locked 10; see src/domain/calibration.ts
    UNION
    SELECT market_id AS onchain_id FROM viewer_market_decisions
      WHERE viewer_wallet = lower(p_wallet)
        AND market_id BETWEEN 2832 AND 2841    -- the Locked 10; see src/domain/calibration.ts
  ) AS distinct_locked_markets;
$$;

REVOKE ALL ON FUNCTION public.simulation_conviction_count(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.simulation_conviction_count(text) TO service_role;
