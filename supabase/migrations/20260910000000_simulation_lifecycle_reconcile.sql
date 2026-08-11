-- SIMULATION LIFECYCLE — the state machine reconciles instead of trapping.
--
-- THE TRAP, EXACTLY. `simulation_graduate` correctly refuses when the conviction
-- count has fallen back below the target — a state written earlier must not
-- permanently close an account on the strength of a count that is no longer true.
-- But it left the account in GRADUATING, and GRADUATING is a dead end:
--
--   · `modeFor` keeps returning GRADUATING, so no new Simulation order opens;
--   · the banner's only action is Continue to Conviction, which is graduation,
--     which refuses;
--   · so the reader can neither finish, nor add the conviction that would let
--     them finish, nor leave by the control in front of them.
--
-- A refusal that removes every exit is worse than the thing it was refusing.
--
-- THE RULE, STATED ONCE AND ENFORCED IN BOTH DIRECTIONS:
--
--   ACTIVE     + count >= target  →  GRADUATING
--   GRADUATING + count <  target  →  ACTIVE
--
-- The first direction is already written by `simulation_execute_order`, in the
-- same transaction as the tenth conviction. What was missing is the second, and
-- the first for convictions that arrive from OUTSIDE Simulation — a real
-- position the indexer writes, a belief recorded elsewhere. No Simulation
-- transaction runs for those, so nothing moved the account and the client was
-- left deriving GRADUATING from a progress count while the stored state still
-- said ACTIVE. A server-side audience cannot see a client derivation, so that
-- person stayed reachable by a Challenge they could not answer.

-- ── One reconciliation, callable from anywhere ──────────────────────────────
--
-- Returns the state the account should be in, and writes it only when it differs
-- — so calling this on a read path costs a lookup rather than a write.
CREATE OR REPLACE FUNCTION public.simulation_reconcile_state(
  p_wallet text,
  p_target integer
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_me    text := lower(p_wallet);
  v_state text;
  v_count integer;
  v_want  text;
BEGIN
  SELECT state INTO v_state FROM simulation_accounts WHERE wallet = v_me;
  IF NOT FOUND THEN RETURN NULL; END IF;

  -- EXITED and GRADUATED are terminal for this purpose. Somebody who has left is
  -- not mid-flight, and a graduated account is a one-way door that a conviction
  -- count must never reopen.
  IF v_state NOT IN ('ACTIVE', 'GRADUATING') THEN RETURN v_state; END IF;

  v_count := simulation_conviction_count(v_me);
  v_want := CASE WHEN v_count >= p_target THEN 'GRADUATING' ELSE 'ACTIVE' END;

  IF v_want <> v_state THEN
    UPDATE simulation_accounts SET state = v_want WHERE wallet = v_me;
  END IF;
  RETURN v_want;
END;
$$;

REVOKE ALL ON FUNCTION public.simulation_reconcile_state(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.simulation_reconcile_state(text, integer) TO service_role;

-- ── Graduation refuses AND releases ─────────────────────────────────────────
--
-- Identical to the shipped function except for the `not_complete` branch, which
-- now reconciles the account back to ACTIVE before returning. The reader sees
-- 9 / 10 and can add one conviction; every other refusal is unchanged.
CREATE OR REPLACE FUNCTION public.simulation_graduate(
  p_wallet text,
  p_target integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_me    text := lower(p_wallet);
  v_row   simulation_accounts%ROWTYPE;
  v_count integer;
BEGIN
  IF v_me IS NULL OR v_me = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_wallet');
  END IF;

  SELECT * INTO v_row FROM simulation_accounts WHERE wallet = v_me FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_account');
  END IF;

  -- Already through the door. Idempotent, so a double tap is not an error.
  IF v_row.state = 'GRADUATED' THEN
    RETURN jsonb_build_object('ok', true, 'account', to_jsonb(v_row));
  END IF;

  IF v_row.state <> 'GRADUATING' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_graduating', 'state', v_row.state);
  END IF;

  v_count := simulation_conviction_count(v_me);
  IF v_count < p_target THEN
    /**
     * REFUSE, AND LET THEM GO.
     *
     * Leaving the account in GRADUATING here is what trapped people: no new
     * order, no graduation, and a banner whose only control is the graduation
     * that just refused. Returning it to ACTIVE puts the reader back where the
     * count says they are — 9 / 10, one conviction from the door.
     */
    UPDATE simulation_accounts SET state = 'ACTIVE' WHERE wallet = v_me
    RETURNING * INTO v_row;
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'not_complete',
      'convictions', v_count,
      'account', to_jsonb(v_row)
    );
  END IF;

  PERFORM simulation_release_challenges(v_me);

  UPDATE simulation_accounts
     SET state = 'GRADUATED',
         graduated_at = coalesce(graduated_at, now()),
         exited_at = now()
   WHERE wallet = v_me
  RETURNING * INTO v_row;

  RETURN jsonb_build_object('ok', true, 'account', to_jsonb(v_row));
END;
$$;

REVOKE ALL ON FUNCTION public.simulation_graduate(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.simulation_graduate(text, integer) TO service_role;

-- ── Who a Simulation Challenge can actually reach ──────────────────────────
--
-- The audience intersection used to test the STORED state alone, which is one
-- reconciliation behind whenever a conviction arrives from outside Simulation.
-- This asks the question the product actually means — "can this person answer a
-- Simulation Challenge right now?" — which is true only for an ACTIVE account
-- that is still below the target, whatever the stored state happens to say.
--
-- It is a FUNCTION rather than a filter in the application because the count is
-- SQL, and expressing it through PostgREST would mean shipping the count back to
-- the server as a second round trip per candidate.
CREATE OR REPLACE FUNCTION public.simulation_reachable_wallets(
  p_wallets text[],
  p_target  integer
)
RETURNS SETOF text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT a.wallet
    FROM simulation_accounts a
   WHERE a.state = 'ACTIVE'
     AND a.wallet = ANY (SELECT lower(w) FROM unnest(p_wallets) AS w)
     AND simulation_conviction_count(a.wallet) < p_target;
$$;

REVOKE ALL ON FUNCTION public.simulation_reachable_wallets(text[], integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.simulation_reachable_wallets(text[], integer) TO service_role;

-- The count is now called per candidate on the audience path, so both tables it
-- folds need the wallet lookup to be an index scan rather than a seq scan.
CREATE INDEX IF NOT EXISTS wallet_beliefs_wallet_idx ON public.wallet_beliefs (wallet);
CREATE INDEX IF NOT EXISTS expressed_beliefs_wallet_idx ON public.expressed_beliefs (wallet);
