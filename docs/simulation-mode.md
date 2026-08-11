# Simulation Mode

**Same product. Separate ledger. Different execution adapter.**

Simulation is not a paper-trading product, a game, or a second onboarding flow.
It is the current Conviction experience with a separate CC balance, separate
simulated orders and positions, no real transaction, no wallet payment, no gas,
and no effect on the real market. It exists for exactly as long as it takes
somebody to build their first ten convictions, and then it ends permanently.

## The two thresholds, and why they stay apart

| Threshold | Constant | Means |
| --- | --- | --- |
| 5 | `CALIBRATION_TARGET` | The pattern is recognizable — DNA can compute closest people, and Challenge unlocks. |
| 10 | `PROFILE_TARGET` | Onboarding is done — Simulation ends. |

Both fold the same count: **distinct markets the viewer has a direction on**,
deduplicated across a live money-backed position, a remembered one
(`last_directional_side`), a completed Simulation position, and any other
expressed belief. Holding both sides, adding, or changing sides is one
conviction — the market is the unit, not the trade.

Raising `CALIBRATION_TARGET` to 10 to make Simulation graduate correctly would
withhold the Network from everybody between five and ten convictions — exactly
the population this mode exists to serve.

## Lifecycle

```
eligible (< 10 convictions, never graduated)
  │  Try Simulation → wallet SIGNATURE (never a transaction) → 1,000 CC, granted once
  ▼
SIMULATION ──── Exit (one tap, no confirmation) ────► REAL   (re-entry allowed)
  │  10th conviction settles
  ▼
GRADUATING ──── Continue to Conviction ────► REAL   (permanent; never offered again)
```

`GRADUATING` is not cosmetic. Between the tenth conviction settling and the
reader pressing Continue, the Simulation receipt is still on screen and the
Simulation position still readable, while no new order may be opened and no new
outgoing Simulation Challenge is offered. Collapsing it into `REAL` would yank a
confirmation mid-read; collapsing it into `SIMULATION` would allow an eleventh.

Leaving — by either door — closes unresolved Simulation Challenges with the
neutral reason `simulation_exit` and deletes unresolved incoming Simulation
calls. Neither is recorded as a pass, and `passed_at` is never set: a pass
reaches Challenge lifecycle and this must not.

## Where things live

| Concern | Owner |
| --- | --- |
| Constants, `formatCC`, lifecycle rules, eligibility | `src/domain/simulation.ts` |
| The 10-conviction count | `src/domain/beliefs.ts` (`profileProgressFor`) |
| Lifecycle + quote + settlement | `src/lib/simulation.server.ts` |
| Public server functions | `src/lib/simulation.functions.ts` |
| Query options (mode in every key) | `src/lib/simulation-query.ts` |
| The one mode answer | `src/lib/simulation-mode.tsx` |
| Real/Simulation execution facade | `src/lib/market-execution.ts` |
| Tables, RPCs, mode columns | `supabase/migrations/20260909000000_simulation_mode.sql` |
| The boundary, asserted closed | `src/lib/simulation-boundary.test.ts` |

## Execution

```
REAL        OrderTicket → chain-trade → wallet → contract → Base
SIMULATION  OrderTicket → simulation adapter → the application database
```

One `OrderTicket`, one `OwnedDock`, one dock hook, shared by desktop and mobile.
The facade hands whichever adapter the active ledger calls for; nothing above it
knows which. `chain-trade.ts` stays real-only and contains no simulation branch.

The Simulation adapter's signature is byte-for-byte `useTrade`'s — it takes wei —
so no call site branches. It converts at its own boundary using the 1:1
convention: **100 CC prices exactly as a real $100 order would**. That is an
internal calculation convention, never an exchange rate, and it never reaches a
screen.

Quotes are re-read **server-side** from the contract's own view functions
(`getTokensForETH` / `getSellProceeds`). A client-supplied share count would be a
client-supplied position.

## What is CC, and what is not

> CC means Conviction Company Units. These units have no monetary value and
> cannot be withdrawn, transferred, redeemed, or exchanged for money or crypto.

CC is deliberately **not** part of `DisplayUnit = "USD" | "ETH"`. It has no rate,
participates in no conversion, and does not appear in the viewer's currency
toggle. It formats through `formatCC` with a **suffix**, never a symbol.

Only user-owned simulated financial state becomes CC. These stay real, in the
viewer's chosen display unit:

- live market price, average execution price
- market-wide capital and volume, public charts
- real creator earnings and protocol statistics

> The position is simulated. The market is not.

## Matching

A settled Simulation buy upserts `expressed_beliefs` with `source = 'simulation'`
at the **fixed** `EXPRESSED_WEIGHT` (0.15) — never scaled by CC committed. CC is
free, so amount-weighted matching would imply certainty the signal does not
support, and a real on-chain position must always override an expressed or
simulated belief on the same market.

There is no second conviction record and no second matching model. The
amount is stored on the order for future behavioural analysis only.

## Data separation

`simulation_accounts`, `simulation_orders` (immutable, idempotency-keyed),
`simulation_positions` (a projection; value is **derived** from the live real
price, never stored), and `simulation_house_rounds`.

`is_simulation` on the real tables is the cheap option and the one that
eventually lies: dozens of existing queries — some of them SQL inside other
migrations — would need to learn about the flag, and the first that forgot would
count play balances as market capital. A separate table cannot be forgotten.

`challenges` and `market_calls` are **social** records, not money records, so
they keep one ledger with a `mode` column (`REAL` by default). Every read, write,
audience calculation, capacity check and answer is scoped by it, including the
active-slot indexes.

The whole order — eligibility, balance, ledger, position, belief, match refresh,
answered calls — is one transaction (`simulation_execute_order`), with the
account row locked and eligibility re-read inside the lock.

## Challenge

Challenge remains a **social call**, not a wager. It never spends, transfers or
locks CC. The Simulation audience is:

```
existing eligible audience  INTERSECT  active Simulation users
```

An intersection, never a second matching algorithm. An empty audience omits the
action rather than rendering it disabled.

## House

The House's *prediction* is shared — its read of a person is the same read in
either ledger, and looking at it consumes nothing. The *round* is not: a real
reveal is proved by a mined transaction, a Simulation reveal by a settled order
id (verified: right wallet, market, side, and a buy). Simulation state lives in
`simulation_house_rounds`, so a simulated position can never consume, reveal or
close the real round for that market.

## Non-goals

No leaderboard, marketplace, Simulation market creation, public Simulation
believers/volume/capital, CC transfers, deposits, withdrawals, purchases,
rewards, conversion to money, conversion of a Simulation position into a real
one, a combined portfolio, a second dashboard, a second order ticket, a second
matching model, or fake convictions and users. There is no reset, faucet or
refill: a reader out of CC reduces or closes positions to recover it.
