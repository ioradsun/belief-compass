-- capital_usd — the whole-market capital standing in a market, as ONE orderable column.
--
-- WHY THIS EXISTS. Explore's lens row offers "Most Capital", and a label is a
-- promise: it must mean the markets with the most capital, not "the markets with
-- the most capital among whatever the other feed rules happened to admit".
--
-- The candidate pool is assembled from purposeful slices, each an ORDER BY over
-- market_state. None of them was capital. The closest, `deep`, orders by
-- volume_total_usd — which is what has been TRADED, not what is STANDING there
-- now; measured against production the top forty by volume and the top forty by
-- capital share only FIVE markets. The result: 15 of the platform's true top 40
-- by capital were absent from the pool entirely, so the lens ranked an
-- incomplete universe while its label claimed otherwise.
--
-- WHY A GENERATED COLUMN AND NOT AN EXPRESSION INDEX. PostgREST's .order() takes
-- a column name; it cannot order on `yes_capital_usd + no_capital_usd`. The
-- alternatives were both worse: fetching the top N by each side separately and
-- merging would silently miss a market split evenly across both sides, and
-- computing the sum in the client would mean fetching all 2,779 rows on every
-- feed build. Storing the sum keeps ONE definition of capital in the database,
-- derived from the two side columns rather than maintained beside them, so it
-- cannot drift from them.
--
-- STORED, not VIRTUAL: the index needs it materialised, and the feed reads this
-- far more often than the ingest writes it.
alter table public.market_state
  add column if not exists capital_usd numeric
  generated always as (coalesce(yes_capital_usd, 0) + coalesce(no_capital_usd, 0)) stored;

comment on column public.market_state.capital_usd is
  'Whole-market capital committed right now, USD: yes_capital_usd + no_capital_usd. Generated — never written directly. Ordering key for the Explore "Most Capital" lens candidate slice.';

-- The pool slice is a single `order by capital_usd desc limit 60`, so the index
-- carries the exact ordering. NULLS LAST matches PostgREST's nullsFirst:false —
-- without it the planner cannot serve the slice from the index alone.
create index if not exists market_state_capital_usd_desc_idx
  on public.market_state (capital_usd desc nulls last);
