# REDUCER-TESTS

The three invariants belief math must uphold (see `src/domain/domain.test.ts`):

**(a) Price-only changes never mutate `expressed_side` or `directional_since`.**
`evaluate()` is a pure projection. Repeated calls with any prices leave the
`BeliefRow` byte-identical. Guards against price drift silently flipping a
wallet's "changed their mind" state.

**(b) `reduce(all) === reduce(a) + reduce(b)` for any split.**
`applyTrade` is a left-fold, so batching is safe. Guards against the reorg
re-scan producing a different result depending on how the trade batch was
carved up.

**(c) Idempotent replay.**
Applying the same ordered canonical trade list twice yields the same row.
Guards against Job B's periodic full-fold from producing drift.

Additional checked properties:
- Cost basis is weighted-average remaining (BUY adds, partial SELL scales
  proportionally, full exit → 0).
- Expressed side is derived from **token shares**, not USD value.
- `evaluate()` `stance_side` can differ from `expressed_side` — that's the
  spec's whole point. Price-only MIXED drift updates People% silently and
  never emits `belief-switched`.
- `matchScore` shrinks toward 50 on thin evidence and returns
  `insufficient: true` under 5 shared directional markets.

Run with `bunx vitest run src/domain/domain.test.ts`.
