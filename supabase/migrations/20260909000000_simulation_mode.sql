-- SIMULATION MODE — a separate financial ledger inside the same database.
--
-- The rule this whole migration exists to enforce: SAME PRODUCT, SEPARATE
-- LEDGER. A Simulation order is a real behavioural signal and a fake financial
-- one, so its BELIEF goes into `expressed_beliefs` (the layer that already
-- normalises free beliefs into DNA, Network, House and matching, at a low fixed
-- weight) while its MONEY goes into tables no real surface reads.
--
-- WHY NOT `is_simulation` ON THE REAL TABLES. It is the obvious cheap option and
-- it is the one that eventually lies. `events`, `wallet_beliefs` and the position
-- tables are read by the indexer, the rollup jobs, capital and volume totals,
-- creator earnings, public believer counts and the tape — dozens of queries, some
-- of them SQL inside other migrations, none of which would learn about a new
-- boolean. Every one of them that forgot the filter would silently count play
-- balances as market capital. A separate table cannot be forgotten: a query that
-- does not name it cannot see it.
--
-- WHAT DOES GET A MODE COLUMN: `challenges` and `market_calls`. Those are SOCIAL
-- records, not money records — "this person asked that person" is equally true in
-- either mode — so they stay in one ledger with a mode stamp, and every read,
-- write, audience and capacity check is scoped by it. Existing rows are REAL.

-- ── The account ─────────────────────────────────────────────────────────────
--
-- One row per wallet, forever. It is created on first activation and never
-- deleted: exiting moves the lifecycle state, it does not erase somebody's
-- progress, and re-entering must not re-grant the starting balance.
CREATE TABLE IF NOT EXISTS public.simulation_accounts (
  wallet               text        PRIMARY KEY,
  -- Granted ONCE, at creation. Immutable afterwards (see the trigger below) —
  -- this is the column a refill or faucet would have to move, and there is no
  -- refill in V1.
  starting_balance_cc  numeric     NOT NULL DEFAULT 1000,
  available_balance_cc numeric     NOT NULL DEFAULT 1000,
  /**
   * WHERE THIS WALLET IS IN THE LIFECYCLE — one column, four states, persisted.
   *
   * A boolean `active` could not express GRADUATING, and GRADUATING is a real
   * product state rather than a rendering detail: between the tenth conviction
   * settling and the reader pressing Continue they can still READ their receipt
   * and their position, but they may not place another order — and, critically,
   * they may not be put into somebody else's Simulation audience, because they
   * can no longer answer. Derived from a boolean plus a progress count, that
   * last rule lived only on the client and the audience query could not see it.
   *
   *   ACTIVE      simulating, orderable, answerable, reachable by a Challenge
   *   GRADUATING  the tenth has landed; readable, but no new order and no new call
   *   EXITED      left below ten; everything preserved, re-entry allowed
   *   GRADUATED   finished at ten; a one-way door, never offered again
   *
   * Set atomically: `simulation_execute_order` writes GRADUATING in the same
   * transaction as the tenth conviction, so there is no window in which somebody
   * is done but still reachable.
   */
  state                text        NOT NULL DEFAULT 'ACTIVE',
  activated_at         timestamptz NOT NULL DEFAULT now(),
  exited_at            timestamptz,
  -- Set once, at ten convictions. A one-way door.
  graduated_at         timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),

  -- A negative CC balance is not a state this product has. Overdraft is a money
  -- concept and CC is not money.
  CONSTRAINT simulation_accounts_balance_nonneg CHECK (available_balance_cc >= 0),
  CONSTRAINT simulation_accounts_state
    CHECK (state IN ('ACTIVE', 'GRADUATING', 'EXITED', 'GRADUATED')),
  -- GRADUATED MEANS OVER. The constraint is what makes "do not offer Simulation
  -- again" a property of the data rather than a rule three components remember.
  CONSTRAINT simulation_accounts_graduated_final
    CHECK ((graduated_at IS NULL) = (state <> 'GRADUATED'))
);

-- THE AUDIENCE INTERSECTION'S ONE ACCESS PATTERN: who can actually answer a
-- Simulation Challenge right now. GRADUATING and EXITED are both excluded by the
-- predicate rather than by a caller remembering to.
CREATE INDEX IF NOT EXISTS simulation_accounts_reachable_idx
  ON public.simulation_accounts (wallet)
  WHERE state = 'ACTIVE';

ALTER TABLE public.simulation_accounts ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.simulation_accounts TO service_role;

-- Wallets are their lowercase form everywhere, and the starting grant is frozen
-- at insert. Both in the database rather than only in the application: a
-- case-varying wallet would defeat the primary key and hand somebody a second
-- 1,000 CC, which is precisely the bug the "granted once" rule is about.
CREATE OR REPLACE FUNCTION public.simulation_accounts_normalize()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.wallet := lower(NEW.wallet);
  IF TG_OP = 'UPDATE' THEN
    NEW.starting_balance_cc := OLD.starting_balance_cc;
    -- A graduated account can never come back. Checked here as well as in the
    -- activate path, because this is the one place every writer passes through.
    IF OLD.state = 'GRADUATED' THEN
      NEW.state := 'GRADUATED';
      NEW.graduated_at := OLD.graduated_at;
    END IF;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS simulation_accounts_normalize_trg ON public.simulation_accounts;
CREATE TRIGGER simulation_accounts_normalize_trg
  BEFORE INSERT OR UPDATE ON public.simulation_accounts
  FOR EACH ROW EXECUTE FUNCTION public.simulation_accounts_normalize();

-- ── The immutable order ledger ──────────────────────────────────────────────
--
-- Every settled Simulation order, forever. There are NO PENDING ROWS: the atomic
-- function below either settles the whole thing or writes nothing at all, so
-- there is no state for a half-finished order to sit in and no sweeper to clean
-- one up.
CREATE TABLE IF NOT EXISTS public.simulation_orders (
  id                bigserial   PRIMARY KEY,
  /**
   * TWO TAPS INSIDE ONE FRAME ARE ONE ORDER.
   *
   * SCOPED TO THE WALLET, not global. A globally unique key means one person's
   * key can collide with another's — the second wallet's genuine order is
   * refused by a constraint it has no way to know about, and a key is a CLIENT
   * value, so nothing stops two clients minting the same one.
   *
   * THE FINGERPRINT IS WHAT MAKES A REPLAY HONEST. A key alone can only answer
   * "have I seen this key"; reusing it for a different order would then return
   * somebody a receipt for an order they did not place. The fingerprint is the
   * order's own identity — market, side, action, size — so the same key with a
   * different payload is REJECTED rather than silently replayed.
   */
  idempotency_key   text        NOT NULL,
  request_fingerprint text      NOT NULL DEFAULT '',
  wallet            text        NOT NULL,
  onchain_id        bigint      NOT NULL,
  side              text        NOT NULL CHECK (side IN ('YES','NO')),
  action            text        NOT NULL CHECK (action IN ('BUY','SELL')),
  amount_cc         numeric     NOT NULL CHECK (amount_cc > 0),
  -- Signed: positive on a buy, negative on a sell. The position is the fold of
  -- these, which is what makes the ledger auditable against the projection.
  share_delta       numeric     NOT NULL,
  -- The LIVE REAL price this order executed against, recorded for history. The
  -- market is real even though the position is not.
  market_price_usd  numeric,
  simulated_fee_cc  numeric     NOT NULL DEFAULT 0 CHECK (simulated_fee_cc >= 0),
  status            text        NOT NULL DEFAULT 'SETTLED' CHECK (status = 'SETTLED'),
  created_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.simulation_orders ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.simulation_orders TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.simulation_orders_id_seq TO service_role;

-- One key per WALLET. Two people may independently mint the same value — a key
-- is a client value, and nothing stops them — and neither one's order may be
-- refused because of the other's.
CREATE UNIQUE INDEX IF NOT EXISTS simulation_orders_idempotency_idx
  ON public.simulation_orders (wallet, idempotency_key);

CREATE INDEX IF NOT EXISTS simulation_orders_wallet_idx
  ON public.simulation_orders (wallet, created_at DESC);
CREATE INDEX IF NOT EXISTS simulation_orders_market_idx
  ON public.simulation_orders (wallet, onchain_id, created_at DESC);

-- IMMUTABLE MEANS IMMUTABLE. A ledger you can edit is a projection with extra
-- steps, and the position rows below are only trustworthy because they can be
-- rebuilt from these.
CREATE OR REPLACE FUNCTION public.simulation_orders_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'simulation_orders is append-only';
END;
$$;

DROP TRIGGER IF EXISTS simulation_orders_immutable_trg ON public.simulation_orders;
CREATE TRIGGER simulation_orders_immutable_trg
  BEFORE UPDATE OR DELETE ON public.simulation_orders
  FOR EACH ROW EXECUTE FUNCTION public.simulation_orders_immutable();

-- ── The position projection ─────────────────────────────────────────────────
--
-- One row per (wallet, market), shaped closely enough to the real position model
-- that the existing ownership domain logic reads it unchanged.
--
-- CURRENT VALUE AND UNREALIZED RETURN ARE DELIBERATELY ABSENT. They are derived
-- from the LIVE REAL market price at read time. Storing them would mean writing
-- a second price for a market that already has one, and a Simulation price that
-- drifted from the real one is the moment Simulation stops teaching anything.
CREATE TABLE IF NOT EXISTS public.simulation_positions (
  wallet                 text        NOT NULL,
  onchain_id             bigint      NOT NULL,
  yes_shares             numeric     NOT NULL DEFAULT 0 CHECK (yes_shares >= 0),
  no_shares              numeric     NOT NULL DEFAULT 0 CHECK (no_shares >= 0),
  yes_cost_cc            numeric     NOT NULL DEFAULT 0 CHECK (yes_cost_cc >= 0),
  no_cost_cc             numeric     NOT NULL DEFAULT 0 CHECK (no_cost_cc >= 0),
  -- The last UNAMBIGUOUS direction. A perfectly balanced position expresses no
  -- belief, and this is what stops the matching layer inventing one — the same
  -- role the column of this name plays on `wallet_beliefs`.
  last_directional_side  text        CHECK (last_directional_side IN ('YES','NO')),
  opened_at              timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet, onchain_id)
);

ALTER TABLE public.simulation_positions ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.simulation_positions TO service_role;

-- "What does this wallet hold" — the only access pattern the product has. A
-- Simulation position is PRIVATE to its owner in V1: nothing reads it by market.
CREATE INDEX IF NOT EXISTS simulation_positions_wallet_idx
  ON public.simulation_positions (wallet)
  WHERE yes_shares > 0 OR no_shares > 0;

-- ── The Simulation House round ──────────────────────────────────────────────
--
-- The real House round lives in `house_predictions` and is CONSUMED by a
-- reveal: a verified mined transaction sets `actual_action`, and that market's
-- round is over for that wallet forever. A Simulation order cannot pass that
-- verification — there is no transaction — and must not consume the round
-- either, or somebody would spend their real reveal on a simulated position.
--
-- So the PREDICTION stays shared (the House's read of a person is the same read
-- whichever ledger they are trading in, and reading it consumes nothing) while
-- the ROUND — what they did, whether it revealed — is recorded here instead.
CREATE TABLE IF NOT EXISTS public.simulation_house_rounds (
  wallet              text        NOT NULL,
  onchain_id          bigint      NOT NULL,
  actual_action       text        CHECK (actual_action IN ('YES','NO','PASS')),
  finalized_via       text        CHECK (finalized_via IN ('bet','pass')),
  -- The settled Simulation order that unlocked it. This is Simulation's
  -- equivalent of a mined transaction hash: the proof, not a claim.
  simulation_order_id bigint      REFERENCES public.simulation_orders(id),
  revealed_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (wallet, onchain_id)
);

ALTER TABLE public.simulation_house_rounds ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.simulation_house_rounds TO service_role;

-- ── Challenge learns which ledger it belongs to ─────────────────────────────
--
-- A social record, so it stays in the existing tables. But a Simulation
-- Challenge may only ever reach another active Simulation user, so every read,
-- write, audience calculation, capacity check and answer is scoped by mode.
-- DEFAULT 'REAL' is what makes every existing row keep meaning exactly what it
-- meant before this migration.
ALTER TABLE public.challenges
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'REAL';
ALTER TABLE public.market_calls
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'REAL';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'challenges_mode_check'
  ) THEN
    ALTER TABLE public.challenges
      ADD CONSTRAINT challenges_mode_check CHECK (mode IN ('REAL','SIMULATION'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'market_calls_mode_check'
  ) THEN
    ALTER TABLE public.market_calls
      ADD CONSTRAINT market_calls_mode_check CHECK (mode IN ('REAL','SIMULATION'));
  END IF;
END;
$$;

/**
 * THE KEY HAS TO CARRY THE MODE, OR THE COLUMN IS ONLY A LABEL.
 *
 * `market_calls` is keyed (market_id, caller_wallet, responder_wallet), which was
 * exactly right while there was one ledger: there is no such thing as a second
 * call from the same person to the same person about the same market.
 *
 * With a mode column and that key unchanged, the two ledgers CONSUME EACH OTHER.
 * A real call between two people on a market makes the Simulation call between
 * the same two people impossible; a Simulation call blocks the later real one.
 * The `ON CONFLICT … DO NOTHING` in `put_on_table` turns that into silence
 * rather than an error — the audience write simply drops the person, and the
 * Challenge reaches one fewer than it says it did. The mode column would be a
 * label on whichever row happened to be written first.
 *
 * So the KEY moves. The uniqueness that mattered is preserved exactly — one call
 * per (market, caller, responder) PER LEDGER — and every conflict target below
 * names all four columns.
 */
ALTER TABLE public.market_calls DROP CONSTRAINT IF EXISTS market_calls_pkey;
ALTER TABLE public.market_calls
  ADD CONSTRAINT market_calls_pkey
  PRIMARY KEY (market_id, caller_wallet, responder_wallet, mode);

-- LEAVING SIMULATION IS NOT A PASS, and the close reason has to be able to say
-- so. An unresolved Simulation Challenge closed at exit must never be recorded
-- against anybody's dependability, in either direction.
ALTER TABLE public.challenges DROP CONSTRAINT IF EXISTS challenges_close_reason_check;
UPDATE public.challenges SET close_reason = NULL
  WHERE close_reason IS NOT NULL
    AND close_reason NOT IN ('creator', 'all_responded', 'simulation_exit');
ALTER TABLE public.challenges
  ADD CONSTRAINT challenges_close_reason_check
  CHECK (close_reason IN ('creator', 'all_responded', 'simulation_exit'));

-- CAPACITY IS PER MODE. Three slots in Simulation and three in Real are not six
-- for one person — nobody is in both modes at once — but the indexes must carry
-- the mode anyway, or a Simulation Challenge would occupy a slot that outlives
-- Simulation itself.
DROP INDEX IF EXISTS public.challenges_active_slot_idx;
CREATE UNIQUE INDEX IF NOT EXISTS challenges_active_slot_idx
  ON public.challenges (challenger_wallet, mode, slot_no)
  WHERE closed_at IS NULL;

DROP INDEX IF EXISTS public.challenges_active_market_idx;
CREATE UNIQUE INDEX IF NOT EXISTS challenges_active_market_idx
  ON public.challenges (challenger_wallet, mode, market_id)
  WHERE closed_at IS NULL;

-- ── How many convictions somebody actually has ──────────────────────────────
--
-- THE CANONICAL COUNT, and it lives in SQL because the eligibility check has to
-- run INSIDE the order transaction. Asking the application first and trusting
-- the answer would leave a window where the tenth and eleventh orders both see
-- nine.
--
-- Four sources, one unit: DISTINCT MARKETS somebody has taken a direction on.
--   · a live money-backed position          wallet_beliefs.stance_side
--   · a remembered one they have since left wallet_beliefs.last_directional_side
--   · a completed Simulation position       expressed_beliefs (source='simulation')
--   · any other expressed belief            expressed_beliefs
--
-- Holding both sides, adding to a position or changing sides is ONE conviction,
-- because the market is the unit and not the trade.
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
        AND (stance_side IN ('YES','NO') OR last_directional_side IN ('YES','NO'))
    UNION
    SELECT onchain_id FROM expressed_beliefs
      WHERE wallet = lower(p_wallet)
  ) AS distinct_markets;
$$;

REVOKE ALL ON FUNCTION public.simulation_conviction_count(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.simulation_conviction_count(text) TO service_role;

-- ── Activation ─────────────────────────────────────────────────────────────
--
-- Idempotent by construction. A returning user resumes their balance and their
-- positions; the ON CONFLICT branch deliberately does not touch
-- `available_balance_cc`, which is the whole "never grant another 1,000 CC"
-- rule expressed as the absence of an assignment.
CREATE OR REPLACE FUNCTION public.simulation_activate(
  p_wallet  text,
  p_start   numeric,
  p_target  integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_me    text := lower(p_wallet);
  v_count integer;
  v_row   simulation_accounts%ROWTYPE;
BEGIN
  IF v_me IS NULL OR v_me = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_wallet');
  END IF;

  SELECT * INTO v_row FROM simulation_accounts WHERE wallet = v_me;
  IF FOUND AND v_row.state = 'GRADUATED' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'graduated');
  END IF;

  v_count := simulation_conviction_count(v_me);
  IF v_count >= p_target THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_eligible', 'convictions', v_count);
  END IF;

  INSERT INTO simulation_accounts (wallet, starting_balance_cc, available_balance_cc, state)
  VALUES (v_me, p_start, p_start, 'ACTIVE')
  ON CONFLICT (wallet) DO UPDATE
    SET state = 'ACTIVE', activated_at = now(), exited_at = NULL
  RETURNING * INTO v_row;

  RETURN jsonb_build_object(
    'ok', true,
    'account', to_jsonb(v_row),
    'convictions', v_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.simulation_activate(text, numeric, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.simulation_activate(text, numeric, integer) TO service_role;

-- ── Leaving ────────────────────────────────────────────────────────────────
--
-- One tap, no confirmation, and NOTHING IS DESTROYED: the account stays, the
-- positions stay, the CC balance stays. Only visibility changes.
--
-- The part that is not merely a flag is the Challenge cleanup. Somebody who has
-- left Simulation cannot answer a Simulation call, so leaving those open would
-- leave other Simulation users waiting for an answer that can never arrive. They
-- are closed with a NEUTRAL reason — not a pass, not a decline, not an ignore —
-- and `passed_at` is deliberately never set, because a pass reaches Challenge
-- lifecycle and this must not.
/**
 * THE CLEANUP BOTH DOORS SHARE.
 *
 * Extracted because it must never be skipped by either, and because the two
 * doors now differ in exactly one respect — what the account state becomes —
 * which is precisely the part that has to be checked rather than copied.
 */
CREATE OR REPLACE FUNCTION public.simulation_release_challenges(p_me text)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  /**
   * OUTGOING, IN BOTH TABLES — and the second half is the one that was missing.
   *
   * Closing the `challenges` row frees the slot, but `buildChallenges` reads
   * `market_calls` DIRECTLY: it filters on mode and on the call being unresolved,
   * and never joins back to its parent. So a closed Challenge whose recipient
   * rows survive keeps asking. Other Simulation users would go on seeing
   * somebody "waiting" on a question that person has walked away from and can no
   * longer answer.
   *
   * The rows are DELETED rather than stamped, for the same reason the incoming
   * ones are: `responded_at` would claim they answered and `passed_at` would
   * claim a choice they never made — and `passed_at` reaches Challenge
   * lifecycle, which this must never touch.
   */
  UPDATE challenges
     SET closed_at = now(), close_reason = 'simulation_exit'
   WHERE challenger_wallet = p_me
     AND mode = 'SIMULATION'
     AND closed_at IS NULL;

  DELETE FROM market_calls
   WHERE caller_wallet = p_me
     AND mode = 'SIMULATION'
     AND responded_at IS NULL
     AND passed_at IS NULL;

  -- INCOMING: Simulation calls addressed to this person that they have not
  -- answered. Deleted for the same reason, and it is the same neutrality: the
  -- caller's own Challenge simply reached one fewer person.
  DELETE FROM market_calls
   WHERE responder_wallet = p_me
     AND mode = 'SIMULATION'
     AND responded_at IS NULL
     AND passed_at IS NULL;

  /**
   * THE ORPHANS THE DELETE ABOVE JUST CREATED.
   *
   * Removing this person's incoming rows can empty somebody ELSE's Challenge.
   * A Challenge that reaches nobody is exactly the corpse `put_on_table` refuses
   * to create — it occupies one of three editorial slots, asks no one, prints no
   * progress, and can never auto-close because `allResponded` is false at zero.
   * Leaving one behind through a side door would be the same bug arriving by a
   * different route, so every affected Challenge is reconciled here.
   */
  UPDATE challenges c
     SET closed_at = now(), close_reason = 'simulation_exit'
   WHERE c.mode = 'SIMULATION'
     AND c.closed_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM market_calls mc WHERE mc.challenge_id = c.id);
END;
$$;

REVOKE ALL ON FUNCTION public.simulation_release_challenges(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.simulation_release_challenges(text) TO service_role;

/**
 * LEAVING. Reversible, always available, and it asks for nothing.
 *
 * There is NO `graduate` PARAMETER, and its removal is the point. A boolean the
 * caller supplies cannot gate a permanent state transition: an authenticated
 * client could activate with zero convictions, send `graduate => true`, and
 * close its own account forever. The UI only offers Continue after the tenth
 * conviction, but a durable lifecycle invariant that depends on an honest client
 * is not an invariant — it is a convention. Graduation now has its own function,
 * which checks the conditions itself.
 */
CREATE OR REPLACE FUNCTION public.simulation_exit(p_wallet text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_me  text := lower(p_wallet);
  v_row simulation_accounts%ROWTYPE;
BEGIN
  IF v_me IS NULL OR v_me = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_wallet');
  END IF;

  PERFORM simulation_release_challenges(v_me);

  -- A graduated account is already out; leaving again must not un-graduate it.
  UPDATE simulation_accounts
     SET state = CASE WHEN state = 'GRADUATED' THEN 'GRADUATED' ELSE 'EXITED' END,
         exited_at = now()
   WHERE wallet = v_me
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_account');
  END IF;
  RETURN jsonb_build_object('ok', true, 'account', to_jsonb(v_row));
END;
$$;

REVOKE ALL ON FUNCTION public.simulation_exit(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.simulation_exit(text) TO service_role;

/**
 * GRADUATING — the one-way door, with the door's conditions checked HERE.
 *
 * TWO REQUIREMENTS, BOTH RE-READ IN THIS TRANSACTION rather than taken from the
 * caller:
 *
 *   · the account is already GRADUATING — which only `simulation_execute_order`
 *     can write, and only in the same transaction as a tenth conviction;
 *   · the conviction count is STILL at or above the target.
 *
 * The second is not redundant with the first. GRADUATING is written once and
 * persists, and a conviction can disappear afterwards — a real position the
 * indexer revises, a belief row removed. Permanently closing an account on the
 * strength of a state written earlier, about a count that is no longer true,
 * is the same class of mistake as trusting the client's boolean.
 */
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
    RETURN jsonb_build_object('ok', false, 'reason', 'not_complete', 'convictions', v_count);
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

-- ── The one write that matters ─────────────────────────────────────────────
--
-- ONE TRANSACTION: eligibility, the balance check, the immutable order, the
-- position, the balance, the belief, the match refresh and the answered calls.
-- Every one of them or none.
--
-- The quote arrives from the caller because only the server-side chain read can
-- produce it (see simulation.server.ts, which re-reads it from Base rather than
-- trusting the browser). What this function owns is everything that must not be
-- decided outside a lock: whether there is enough CC, whether there are enough
-- shares, and whether this person is still allowed to be here.
/**
 * A SETTLED ORDER, RETURNED WITHOUT REDOING ANY OF IT.
 *
 * Split out so the SERVER can answer a retry before it reads an ETH/USD rate or
 * a contract quote. Without this, a resend of an order that already settled
 * could fail because pricing happened to be unavailable — the caller would be
 * told their order did not go through, about an order that did. A replay must
 * depend on nothing but the row.
 *
 * Returns the same shape as `simulation_execute_order`, or `ok:false` /
 * `not_found` when there is nothing to replay.
 */
CREATE OR REPLACE FUNCTION public.simulation_replay_order(
  p_wallet          text,
  p_idempotency_key text,
  p_fingerprint     text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_me    text := lower(p_wallet);
  v_order simulation_orders%ROWTYPE;
  v_acct  simulation_accounts%ROWTYPE;
  v_pos   simulation_positions%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM simulation_orders
   WHERE wallet = v_me AND idempotency_key = p_idempotency_key;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- THE SAME KEY FOR A DIFFERENT ORDER IS A MISTAKE, NOT A RETRY. Replaying it
  -- would hand somebody a receipt for an order they did not place.
  IF p_fingerprint IS NOT NULL
     AND p_fingerprint <> ''
     AND v_order.request_fingerprint <> ''
     AND v_order.request_fingerprint <> p_fingerprint THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'idempotency_conflict');
  END IF;

  SELECT * INTO v_acct FROM simulation_accounts WHERE wallet = v_me;
  SELECT * INTO v_pos FROM simulation_positions
   WHERE wallet = v_me AND onchain_id = v_order.onchain_id;

  RETURN jsonb_build_object(
    'ok', true,
    'replayed', true,
    'order', to_jsonb(v_order),
    'account', to_jsonb(v_acct),
    'position', to_jsonb(v_pos),
    'convictions', simulation_conviction_count(v_me),
    'answered', '[]'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.simulation_replay_order(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.simulation_replay_order(text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.simulation_execute_order(
  p_wallet          text,
  p_market_id       bigint,
  p_side            text,
  p_action          text,
  p_amount_cc       numeric,
  p_share_delta     numeric,
  p_price_usd       numeric,
  p_fee_cc          numeric,
  p_idempotency_key text,
  p_weight          numeric,
  p_target          integer,
  /** The order's own identity, so a reused key with a different payload fails. */
  p_fingerprint     text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_me        text := lower(p_wallet);
  v_acct      simulation_accounts%ROWTYPE;
  v_pos       simulation_positions%ROWTYPE;
  v_order     simulation_orders%ROWTYPE;
  v_replay    jsonb;
  v_count     integer;
  v_side_yes  boolean := (p_side = 'YES');
  v_shares    numeric;
  v_cost      numeric;
  v_new_yes   numeric;
  v_new_no    numeric;
  v_new_ycost numeric;
  v_new_ncost numeric;
  v_dir       text;
  v_answered  jsonb;
BEGIN
  IF v_me IS NULL OR v_me = '' OR p_market_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'failed');
  END IF;
  IF p_side NOT IN ('YES','NO') OR p_action NOT IN ('BUY','SELL') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'failed');
  END IF;

  -- THE SAME KEY IS THE SAME ORDER, and this is the CHEAP answer: a double tap
  -- costs a read rather than a queue behind the first one's lock.
  v_replay := simulation_replay_order(v_me, p_idempotency_key, p_fingerprint);
  IF (v_replay->>'ok')::boolean THEN RETURN v_replay; END IF;
  IF v_replay->>'reason' = 'idempotency_conflict' THEN RETURN v_replay; END IF;

  -- THE LOCK. Everything below reads state that another tab could be changing.
  SELECT * INTO v_acct FROM simulation_accounts WHERE wallet = v_me FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_account');
  END IF;

  /**
   * AND AGAIN, NOW THAT WE HOLD THE LOCK.
   *
   * The check above happened BEFORE the lock, which is what makes it cheap — and
   * also what makes it insufficient on its own. Two concurrent submissions of the
   * same order both miss it, the first settles and releases, and the second then
   * acquires the lock in a world where its order already exists. Without this
   * second look it would carry on and collide with the unique index, and a
   * DUPLICATE SUBMISSION WOULD FAIL rather than replay — the precise case the
   * whole mechanism exists for.
   */
  v_replay := simulation_replay_order(v_me, p_idempotency_key, p_fingerprint);
  IF (v_replay->>'ok')::boolean THEN RETURN v_replay; END IF;
  IF v_replay->>'reason' = 'idempotency_conflict' THEN RETURN v_replay; END IF;

  IF v_acct.state <> 'ACTIVE' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'inactive', 'state', v_acct.state);
  END IF;

  -- STILL ELIGIBLE? Re-read inside the lock. This is what makes the tenth
  -- conviction actually end Simulation instead of ending it approximately.
  v_count := simulation_conviction_count(v_me);
  IF v_count >= p_target THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'complete', 'convictions', v_count);
  END IF;

  SELECT * INTO v_pos FROM simulation_positions
    WHERE wallet = v_me AND onchain_id = p_market_id FOR UPDATE;
  IF NOT FOUND THEN
    v_pos.wallet := v_me;
    v_pos.onchain_id := p_market_id;
    v_pos.yes_shares := 0; v_pos.no_shares := 0;
    v_pos.yes_cost_cc := 0; v_pos.no_cost_cc := 0;
    v_pos.last_directional_side := NULL;
  END IF;

  v_new_yes   := v_pos.yes_shares;
  v_new_no    := v_pos.no_shares;
  v_new_ycost := v_pos.yes_cost_cc;
  v_new_ncost := v_pos.no_cost_cc;
  v_dir       := v_pos.last_directional_side;

  IF p_action = 'BUY' THEN
    IF p_amount_cc <= 0 OR p_share_delta <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'failed');
    END IF;
    IF p_amount_cc > v_acct.available_balance_cc THEN
      RETURN jsonb_build_object(
        'ok', false, 'reason', 'insufficient_cc',
        'available', v_acct.available_balance_cc
      );
    END IF;
    IF v_side_yes THEN
      v_new_yes := v_new_yes + p_share_delta;
      v_new_ycost := v_new_ycost + p_amount_cc;
    ELSE
      v_new_no := v_new_no + p_share_delta;
      v_new_ncost := v_new_ncost + p_amount_cc;
    END IF;
    v_dir := p_side;
    v_acct.available_balance_cc := v_acct.available_balance_cc - p_amount_cc;
    v_shares := p_share_delta;
    v_cost := p_amount_cc;
  ELSE
    -- SELL. `p_share_delta` arrives positive and is stored negative: the ledger
    -- is signed so the position is exactly the fold of it.
    IF p_share_delta <= 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'failed');
    END IF;
    IF v_side_yes AND p_share_delta > v_pos.yes_shares THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_shares');
    END IF;
    IF NOT v_side_yes AND p_share_delta > v_pos.no_shares THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_shares');
    END IF;
    IF v_side_yes THEN
      -- Cost basis is reduced PROPORTIONALLY, so a partial exit leaves a cost
      -- that still matches the shares still held.
      v_new_ycost := CASE WHEN v_pos.yes_shares > 0
        THEN v_new_ycost * (1 - (p_share_delta / v_pos.yes_shares)) ELSE 0 END;
      v_new_yes := v_new_yes - p_share_delta;
    ELSE
      v_new_ncost := CASE WHEN v_pos.no_shares > 0
        THEN v_new_ncost * (1 - (p_share_delta / v_pos.no_shares)) ELSE 0 END;
      v_new_no := v_new_no - p_share_delta;
    END IF;
    v_acct.available_balance_cc := v_acct.available_balance_cc + p_amount_cc;
    v_shares := -p_share_delta;
    v_cost := p_amount_cc;
    -- Selling out of a side does not erase which side you were on. The remembered
    -- direction only changes when the OTHER side is now the larger one.
    IF v_new_yes > v_new_no THEN v_dir := 'YES';
    ELSIF v_new_no > v_new_yes THEN v_dir := 'NO';
    END IF;
  END IF;

  INSERT INTO simulation_orders (
    idempotency_key, request_fingerprint, wallet, onchain_id, side, action,
    amount_cc, share_delta, market_price_usd, simulated_fee_cc
  )
  VALUES (
    p_idempotency_key, coalesce(p_fingerprint, ''), v_me, p_market_id, p_side, p_action,
    v_cost, v_shares, p_price_usd, coalesce(p_fee_cc, 0)
  )
  RETURNING * INTO v_order;

  INSERT INTO simulation_positions (
    wallet, onchain_id, yes_shares, no_shares, yes_cost_cc, no_cost_cc,
    last_directional_side, updated_at
  )
  VALUES (v_me, p_market_id, v_new_yes, v_new_no, v_new_ycost, v_new_ncost, v_dir, now())
  ON CONFLICT (wallet, onchain_id) DO UPDATE
    SET yes_shares = EXCLUDED.yes_shares,
        no_shares = EXCLUDED.no_shares,
        yes_cost_cc = EXCLUDED.yes_cost_cc,
        no_cost_cc = EXCLUDED.no_cost_cc,
        last_directional_side = EXCLUDED.last_directional_side,
        updated_at = now()
  RETURNING * INTO v_pos;

  UPDATE simulation_accounts
     SET available_balance_cc = v_acct.available_balance_cc
   WHERE wallet = v_me
  RETURNING * INTO v_acct;

  -- THE BELIEF. This is the bridge into DNA, Network, House and matching, and it
  -- is the EXISTING one — no second conviction record, no second matching model.
  -- The weight is the fixed expressed-belief weight: CC has no value, so the
  -- amount somebody committed must not make the signal look stronger.
  --
  -- A balanced position expresses nothing, so it writes nothing rather than
  -- guessing a side.
  IF v_dir IN ('YES','NO') AND (v_new_yes > 0 OR v_new_no > 0) THEN
    INSERT INTO expressed_beliefs (wallet, onchain_id, side, weight, source, updated_at)
    VALUES (v_me, p_market_id, v_dir, p_weight, 'simulation', now())
    ON CONFLICT (wallet, onchain_id) DO UPDATE
      SET side = EXCLUDED.side,
          weight = EXCLUDED.weight,
          source = EXCLUDED.source,
          updated_at = now();
    -- The DNA version trigger only fires on wallet_beliefs, so a belief written
    -- here has to enqueue its own recompute or the Network never updates.
    PERFORM request_viewer_match_refresh(v_me);
  END IF;

  -- ANSWERED. A completed Simulation position answers the Simulation calls
  -- waiting on this market — and only those. A real call is not answered by a
  -- simulated position, which is the entire reason `mode` is in the predicate.
  WITH answered AS (
    UPDATE market_calls
       SET responded_at = now()
     WHERE market_id = p_market_id
       AND responder_wallet = v_me
       AND mode = 'SIMULATION'
       AND responded_at IS NULL
       AND passed_at IS NULL
    RETURNING caller_wallet
  )
  SELECT coalesce(jsonb_agg(caller_wallet), '[]'::jsonb) INTO v_answered FROM answered;

  /**
   * THE TENTH CONVICTION ENDS SIMULATION HERE, IN THIS TRANSACTION.
   *
   * It used to be a client-side derivation — "account active AND progress
   * complete" — which meant the DATABASE still read this person as fully ACTIVE
   * until they got round to pressing Continue. The audience query cannot see a
   * client derivation, so somebody who had finished could still be put into a
   * new Simulation Challenge they were already forbidden from answering.
   *
   * Writing GRADUATING in the same transaction as the conviction that caused it
   * closes that window entirely: there is no instant at which somebody is done
   * and still reachable. The state moves to GRADUATED only when they press
   * Continue, because an unread receipt is not a finished experience.
   */
  v_count := simulation_conviction_count(v_me);
  IF v_count >= p_target AND v_acct.state = 'ACTIVE' THEN
    UPDATE simulation_accounts SET state = 'GRADUATING' WHERE wallet = v_me
    RETURNING * INTO v_acct;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'replayed', false,
    'order', to_jsonb(v_order),
    'account', to_jsonb(v_acct),
    'position', to_jsonb(v_pos),
    'convictions', v_count,
    'answered', v_answered
  );
END;
$$;

REVOKE ALL ON FUNCTION public.simulation_execute_order(
  text, bigint, text, text, numeric, numeric, numeric, numeric, text, numeric, integer, text
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.simulation_execute_order(
  text, bigint, text, text, numeric, numeric, numeric, numeric, text, numeric, integer, text
) TO service_role;

-- ── put_on_table learns the mode ───────────────────────────────────────────
--
-- The five-argument form is the real one now; the four-argument signature stays
-- as a REAL-mode wrapper so nothing that already calls it has to change to keep
-- meaning what it meant. Everything inside is the 20260908 function verbatim
-- apart from the mode: the same collide-don't-count slot allocator, the same
-- validated lineage pointer, the same subtransaction that undoes a Challenge
-- which reached nobody.
CREATE OR REPLACE FUNCTION public.put_on_table(
  p_challenger  text,
  p_market_id   bigint,
  p_parent_call bigint,
  p_audience    jsonb,
  p_mode        text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_me       text    := lower(p_challenger);
  v_mode     text    := coalesce(p_mode, 'REAL');
  v_id       bigint;
  v_slot     smallint;
  v_reached  integer;
  v_count    integer;
  v_reason   text    := 'failed';
BEGIN
  IF v_me IS NULL OR v_me = '' OR p_market_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'failed');
  END IF;
  IF v_mode NOT IN ('REAL','SIMULATION') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'failed');
  END IF;

  v_count := coalesce(jsonb_array_length(p_audience), 0);
  IF v_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_audience');
  END IF;

  IF EXISTS (
    SELECT 1 FROM challenges
     WHERE challenger_wallet = v_me
       AND market_id = p_market_id
       AND mode = v_mode
       AND closed_at IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_up');
  END IF;

  IF p_parent_call IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM market_calls c
       WHERE c.id = p_parent_call
         AND c.market_id = p_market_id
         AND c.responder_wallet = v_me
         AND c.caller_wallet <> v_me
         AND c.mode = v_mode
         AND c.responded_at IS NOT NULL
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'bad_parent');
    END IF;
  END IF;

  BEGIN
    FOR v_slot IN 1..3 LOOP
      BEGIN
        INSERT INTO challenges (challenger_wallet, market_id, slot_no, parent_call, mode)
        VALUES (v_me, p_market_id, v_slot, p_parent_call, v_mode)
        RETURNING id INTO v_id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        v_id := NULL;
      END;
    END LOOP;

    IF v_id IS NULL THEN
      IF EXISTS (
        SELECT 1 FROM challenges
         WHERE challenger_wallet = v_me
           AND market_id = p_market_id
           AND mode = v_mode
           AND closed_at IS NULL
      ) THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'already_up');
      END IF;
      RETURN jsonb_build_object('ok', false, 'reason', 'full');
    END IF;

    UPDATE market_calls
       SET challenge_id = v_id
     WHERE market_id = p_market_id
       AND caller_wallet = v_me
       AND mode = v_mode
       AND responded_at IS NULL
       AND passed_at IS NULL;

    INSERT INTO market_calls (
      market_id, caller_wallet, responder_wallet, relation_at_call, challenge_id, mode
    )
    SELECT
      p_market_id,
      v_me,
      lower(a->>'wallet'),
      a->>'relation',
      v_id,
      v_mode
    FROM jsonb_array_elements(p_audience) AS a
    WHERE coalesce(a->>'wallet', '') <> ''
      AND lower(a->>'wallet') <> v_me
    -- All FOUR key columns. Naming three would make a real call swallow the
    -- Simulation one silently, which is the whole reason the key moved.
    ON CONFLICT (market_id, caller_wallet, responder_wallet, mode) DO NOTHING;

    SELECT count(*) INTO v_reached FROM market_calls WHERE challenge_id = v_id;

    IF v_reached = 0 THEN
      v_reason := 'no_reach';
      RAISE EXCEPTION 'put_on_table: challenge % reached nobody', v_id;
    END IF;

    RETURN jsonb_build_object('ok', true, 'id', v_id, 'reached', v_reached);

  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', v_reason,
      'detail', SQLERRM,
      'code', SQLSTATE
    );
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.put_on_table(
  p_challenger  text,
  p_market_id   bigint,
  p_parent_call bigint,
  p_audience    jsonb
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT public.put_on_table(p_challenger, p_market_id, p_parent_call, p_audience, 'REAL');
$$;

REVOKE ALL ON FUNCTION public.put_on_table(text, bigint, bigint, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.put_on_table(text, bigint, bigint, jsonb, text) TO service_role;
REVOKE ALL ON FUNCTION public.put_on_table(text, bigint, bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.put_on_table(text, bigint, bigint, jsonb) TO service_role;

-- Scoping every Challenge read by mode is a filter on these two tables, so both
-- get an index that leads with the mode-carrying access pattern.
CREATE INDEX IF NOT EXISTS market_calls_mode_responder_idx
  ON public.market_calls (mode, responder_wallet, market_id)
  WHERE responded_at IS NULL;
CREATE INDEX IF NOT EXISTS challenges_mode_open_idx
  ON public.challenges (mode, challenger_wallet)
  WHERE closed_at IS NULL;
