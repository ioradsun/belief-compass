ALTER TABLE public.market_calls
  DROP CONSTRAINT IF EXISTS market_calls_relation;

ALTER TABLE public.market_calls
  ADD CONSTRAINT market_calls_relation CHECK (
    relation_at_call IN ('twin', 'tribe', 'neutral', 'opp', 'inverse', 'insufficient')
  );