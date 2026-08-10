-- STILL FORMING — widening what a call may remember about a relationship.
--
-- `relation_at_call` is frozen at call creation and never updated, because a
-- record of what somebody did must not change because of what they later became.
-- That reasoning is untouched. What changes is the SET of relationships a call
-- is allowed to have been made under.
--
-- THE CHECK WAS THE HARD BLOCKER. It admitted exactly the four strong labels:
--
--   CHECK (relation_at_call IN ('twin', 'tribe', 'opp', 'inverse'))
--
-- so a Challenge reaching somebody the DNA engine calls `neutral` — or somebody
-- known only as a closest match — would not have failed a type check or rendered
-- oddly. Postgres would have REJECTED THE INSERT, and because the audience is
-- written as one statement, the whole Challenge would have reached nobody. The
-- Still Forming group was unimplementable behind this line, whatever the
-- application did.
--
-- WHY THESE TWO NAMES AND NOT A THIRD. `neutral` and `insufficient` are the DNA
-- engine's OWN labels for "evaluated, no strong relationship" and "not enough
-- shared history to say". Still Forming is a user-facing GROUPING of those two;
-- it is not a relationship and must never be stored as one. Freezing
-- `relation_at_call: 'forming'` would turn presentation copy into relationship
-- truth, and the day the grouping changed, every historical row would be lying
-- about what the engine actually knew at the time.
ALTER TABLE public.market_calls
  DROP CONSTRAINT IF EXISTS market_calls_relation;

ALTER TABLE public.market_calls
  ADD CONSTRAINT market_calls_relation CHECK (
    relation_at_call IN ('twin', 'tribe', 'neutral', 'opp', 'inverse', 'insufficient')
  );

-- NOTHING IS BACKFILLED, and nothing needs to be: every existing row was written
-- under one of the four strong labels and remains exactly as true as it was.
-- This widens what may be written from today; it rewrites no history.
