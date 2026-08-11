-- PUTTING SOMETHING ON THE TABLE, ATOMICALLY — one statement, or none of it.
--
-- THE GHOST CHALLENGE. The application did this in four round trips: take a
-- slot, insert the `challenges` row, repoint last run's unanswered calls at it,
-- then write the recipients. Only the first two could fail loudly. When the
-- recipient write failed it was LOGGED AND SWALLOWED, and the function returned
-- `ok: true` with `reached: 0` — a Challenge that exists, occupies one of three
-- editorial slots, asks nobody, prints no progress sentence, and can never
-- auto-close because `allResponded` is false at zero. It holds that slot forever.
--
-- The unapplied `market_calls_relation` CHECK is what made this visible: a
-- Challenge reaching a Still Forming person would be rejected by Postgres and
-- produce exactly that ghost. But the CHECK is only the current trigger. ANY
-- failure of the recipient write — a foreign key, a dropped connection, a
-- statement timeout on a large audience — produces the same corpse.
--
-- WHY NOT A COMPENSATING CLOSE. The obvious repair is "if the recipients did not
-- land, close the Challenge". It is wrong here, and not marginally. Step three
-- has ALREADY REPOINTED last run's unanswered calls at the new Challenge by the
-- time step four fails. Closing the new row strands those people: their calls
-- now belong to a closed Challenge, so the question they were still being asked
-- has quietly stopped being asked, and their original Challenge cannot be
-- restored because the pointer that said which one it was has been overwritten.
-- A compensating action cannot recover information the failed sequence destroyed.
-- The write has to be undone, not apologised for.
--
-- SO IT IS ONE FUNCTION, AND A FUNCTION IS ONE TRANSACTION. The slot, the
-- Challenge, the carry, the recipients and the reach count all commit together
-- or none of them happen. The invariant the caller may rely on:
--
--   ok = true   →  a durable, active Challenge exists AND reached > 0
--   ok = false  →  no Challenge exists AND no slot was consumed AND no carried
--                  call was repointed
--
-- WHAT IS UNCHANGED. The cap is still COLLIDED WITH, never counted — the slot
-- loop below is the same allocator, letting `challenges_active_slot_idx` reject a
-- taken slot rather than reading a count that was true a moment ago. The
-- recipient write is still an upsert with `DO NOTHING`, because
-- `market_calls`'s primary key is unique FOREVER rather than per Challenge and a
-- plain multi-row INSERT would roll the whole audience back on one repeat. And
-- `relation_at_call` is still written once and never rewritten: the carry
-- deliberately does not touch it.

CREATE OR REPLACE FUNCTION public.put_on_table(
  p_challenger  text,
  p_market_id   bigint,
  p_parent_call bigint,
  -- [{ "wallet": "0x…", "relation": "twin" }, …] — the frozen audience. The
  -- GROUP is never sent: "Still Forming" is a heading on a screen, and a row
  -- storing it would make presentation copy permanent.
  p_audience    jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
-- SECURITY INVOKER on purpose. Both tables have RLS on with no policy, so this
-- is reachable only by a role that bypasses RLS — the service role the server
-- already uses. A DEFINER function would hand that bypass to anybody who could
-- call it, which is a larger grant than this needs.
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_me       text    := lower(p_challenger);
  v_id       bigint;
  v_slot     smallint;
  v_reached  integer;
  v_count    integer;
  -- Survives the rollback below, because plpgsql variables are not
  -- transactional. It is how a raise that undoes everything can still report
  -- WHICH refusal it was.
  v_reason   text    := 'failed';
BEGIN
  IF v_me IS NULL OR v_me = '' OR p_market_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'failed');
  END IF;

  v_count := coalesce(jsonb_array_length(p_audience), 0);
  IF v_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_audience');
  END IF;

  -- ALREADY UP. Asked before the slot walk so the caller hears the accurate
  -- reason: without it, all three slot attempts would collide on
  -- `challenges_active_market_idx` and the honest "this question is already on
  -- your table" would be reported as "your table is full".
  IF EXISTS (
    SELECT 1 FROM challenges
     WHERE challenger_wallet = v_me
       AND market_id = p_market_id
       AND closed_at IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_up');
  END IF;

  -- THE LINEAGE POINTER IS VALIDATED, NOT TRUSTED.
  --
  -- `parent_call` arrives from the client's relay flow, and the foreign key only
  -- proves the call EXISTS. A chain drawn from an unchecked pointer would say
  -- "Maya → Sundeep → You" on the strength of a number, so all four things a
  -- real relay implies are required: the parent is in this market, it was
  -- addressed to the person now putting the question up, they actually answered
  -- it, and they are not their own caller.
  IF p_parent_call IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM market_calls c
       WHERE c.id = p_parent_call
         AND c.market_id = p_market_id
         AND c.responder_wallet = v_me
         AND c.caller_wallet <> v_me
         AND c.responded_at IS NOT NULL
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'bad_parent');
    END IF;
  END IF;

  /**
   * EVERYTHING THAT WRITES LIVES INSIDE THIS BLOCK.
   *
   * A plpgsql block with an EXCEPTION handler is a subtransaction: reaching the
   * handler undoes every row the block touched. That is the entire mechanism —
   * the slot, the Challenge, the repointed carry and any recipients that did
   * land are gone together, and the caller is told no.
   */
  BEGIN
    -- THE CAP, COLLIDED WITH. Not a retry loop around a failure — it IS the
    -- allocator. Falling out of it means Postgres refused all three.
    FOR v_slot IN 1..3 LOOP
      BEGIN
        INSERT INTO challenges (challenger_wallet, market_id, slot_no, parent_call)
        VALUES (v_me, p_market_id, v_slot, p_parent_call)
        RETURNING id INTO v_id;
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        v_id := NULL;
      END;
    END LOOP;

    IF v_id IS NULL THEN
      -- Both indexes raise 23505. A second tab that won the race between the
      -- check above and this loop is `already_up`, not a full table.
      IF EXISTS (
        SELECT 1 FROM challenges
         WHERE challenger_wallet = v_me
           AND market_id = p_market_id
           AND closed_at IS NULL
      ) THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'already_up');
      END IF;
      RETURN jsonb_build_object('ok', false, 'reason', 'full');
    END IF;

    -- STILL WAITING FROM LAST TIME? THEY MOVE WITH THE QUESTION. Terminated rows
    -- never move — history belongs to the Challenge it happened under — and
    -- `relation_at_call` is deliberately absent from the SET.
    UPDATE market_calls
       SET challenge_id = v_id
     WHERE market_id = p_market_id
       AND caller_wallet = v_me
       AND responded_at IS NULL
       AND passed_at IS NULL;

    -- THE FREEZE. One row per qualified person, the relationship stamped as it is
    -- right now and never recomputed.
    INSERT INTO market_calls (
      market_id, caller_wallet, responder_wallet, relation_at_call, challenge_id
    )
    SELECT
      p_market_id,
      v_me,
      lower(a->>'wallet'),
      a->>'relation',
      v_id
    FROM jsonb_array_elements(p_audience) AS a
    WHERE coalesce(a->>'wallet', '') <> ''
      AND lower(a->>'wallet') <> v_me
    ON CONFLICT (market_id, caller_wallet, responder_wallet) DO NOTHING;

    -- WHAT IT ACTUALLY REACHED, READ BACK FROM THE ROWS. Not the length of the
    -- array that was hoped for — that number was returned regardless of whether
    -- a single row landed, and is how the ghost stayed invisible for as long as
    -- it did.
    SELECT count(*) INTO v_reached FROM market_calls WHERE challenge_id = v_id;

    IF v_reached = 0 THEN
      -- A Challenge that asks nobody is the corpse this function exists to
      -- prevent. Raising here rolls the slot and the Challenge back with it.
      v_reason := 'no_reach';
      RAISE EXCEPTION 'put_on_table: challenge % reached nobody', v_id;
    END IF;

    RETURN jsonb_build_object('ok', true, 'id', v_id, 'reached', v_reached);

  EXCEPTION WHEN OTHERS THEN
    -- Undone: the slot, the Challenge row, the carry, and any recipients that
    -- did land. `detail` is for the server log, never for a screen.
    RETURN jsonb_build_object(
      'ok', false,
      'reason', v_reason,
      'detail', SQLERRM,
      'code', SQLSTATE
    );
  END;
END;
$$;

-- Functions are EXECUTE-to-PUBLIC by default, and this one writes.
REVOKE ALL ON FUNCTION public.put_on_table(text, bigint, bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.put_on_table(text, bigint, bigint, jsonb) TO service_role;
