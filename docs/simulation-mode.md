# Simulation Mode

**Same product. Separate ledger. Different execution adapter.**

Simulation is not a paper-trading product, a game, or a second onboarding flow.
It is the current Conviction experience with a separate CC balance, separate
simulated orders and positions, no real transaction, no wallet payment, no gas,
and no effect on the real market. It exists for exactly as long as it takes
somebody to build their first ten convictions, and then it ends permanently.

## The two thresholds, and why they stay apart

| Threshold | Constant             | Means                                                                                |
| --------- | -------------------- | ------------------------------------------------------------------------------------ |
| 5         | `CALIBRATION_TARGET` | The pattern is recognizable — DNA can compute closest people, and Challenge unlocks. |
| 10        | `PROFILE_TARGET`     | Onboarding is done — Simulation ends.                                                |

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
  │  ▲
  │  │ count < 10 again
  │  ▼
GRADUATING ──── Continue to Conviction ────► REAL   (permanent; never offered again)
       └─────── Exit ───────────────────────► REAL   (re-entry allowed)
```

**The middle arrow runs in both directions**, and it has to:

```
ACTIVE     + count >= target  →  GRADUATING
GRADUATING + count <  target  →  ACTIVE
```

The downward direction is written by the order transaction alongside the tenth
conviction. The upward one is `simulation_reconcile_state`, and without it
`GRADUATING` was a trap: a conviction that fell away after the state was written
left somebody who could not graduate (the count is short, and the server rightly
refuses), could not open a new Simulation order (the client reads `GRADUATING` as
finished), and could not leave either, because the only control on the banner was
the graduation that had just refused. A refusal that removes every exit is worse
than the thing it was refusing.

So a refused graduation now **hands the account back**: `simulation_graduate`
returns `{ ok: false, reason: 'not_complete', convictions }` _and_ sets the state
to `ACTIVE` in the same statement. The reader sees 9 / 10 and one more conviction
opens the door. The client treats that reply as an **outcome**, not an error — it
writes the reconciled state back and shows a line, rather than a red failure.

The banner keeps two distinct actions at graduation for the same reason: Continue
is the one-way door the server may refuse, and **Exit** is the reversible one it
cannot. The help sheet's Exit is always the reversible one, in either state.

`GRADUATING` is not cosmetic. Between the tenth conviction settling and the
reader pressing Continue, the Simulation receipt is still on screen and the
Simulation position still readable, while no new order may be opened and no new
outgoing Simulation Challenge is offered. Collapsing it into `REAL` would yank a
confirmation mid-read; collapsing it into `SIMULATION` would allow an eleventh.

**Graduation is earned, not requested.** Exit and graduate are two functions, not
one call with a boolean — `simulation_exit(wallet)` and
`simulation_graduate(wallet, target)`. A flag the client supplies cannot gate a
permanent state transition: an authenticated client could otherwise activate with
zero convictions, ask to graduate, and close its own account forever. The
graduate path locks the account row and re-reads **both** conditions itself: the
state must already be `GRADUATING` (which only the order transaction writes, and
only alongside a tenth conviction) and the count must **still** be at or above
the target — a conviction can disappear after `GRADUATING` was written, and
closing an account on the strength of a stale count is the same mistake as
trusting the flag.

Leaving — by either door — closes unresolved Simulation Challenges with the
neutral reason `simulation_exit` and deletes unresolved incoming Simulation
calls. Neither is recorded as a pass, and `passed_at` is never set: a pass
reaches Challenge lifecycle and this must not.

## Privacy, and why it is a three-way split

A wallet address is public, so anything keyed by one and not proved is readable
by anyone who knows it. But the line is drawn by _what the answer is_, not by
read-versus-write:

|                      |                                                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **Private, signed**  | the account's contents — CC balance, timestamps — the positions, and every write                                 |
| **Public, unsigned** | the **routing fact**: which ledger owns execution. One lifecycle state, nothing else                             |
| **Public, unsigned** | the conviction count — an aggregate, and the number the entry card must print before anybody has signed anything |

Private reads take a **required** session and read the wallet
`assertWalletOwnership` returns, never the one the request claimed. No read ever
opens a wallet: the queries supply a session that already exists and resolve to
the empty answer when there is none.

The routing fact cannot require a signature. The application has to know which
executor to offer _before_ anybody signs, and an app that cannot answer that has
only two options — refuse to trade at all, or guess. Guessing means treating an
unproved state as Real Mode. It discloses that an address is, or once was, in
Simulation; that is materially weaker than the ledger itself, and it is the price
of routing execution safely rather than optimistically.

## UNKNOWN is a mode

```
UNKNOWN ──► REAL | SIMULATION | GRADUATING
```

`modeFor` returns `UNKNOWN` for an unresolved routing fact, and `REAL` only on a
**positive** answer — the server looked and there is no account, or it is
`EXITED`/`GRADUATED`. "Could not establish the mode" and "confirmed Real Mode"
are different facts, and a type with three states could not tell them apart.

While the mode is `UNKNOWN` the execution facade hands out a **refusing**
adapter: neither `realTrade` nor `simTrade` is reachable, its `buy`/`sell`
reject, the confirm button reads _Checking your account…_ and is disabled, and
the owned dock reports no holdings in either ledger. `executorFor` tests
`resolved` first and on its own — leading with `simulated` would read an
unresolved mode as "not simulated", which is the original defect. It is a
function rather than a ternary inside the hook so the decision can be _run_ in a
test (`simulation-departure.test.ts`) instead of only grepped for.

**Leaving is a request, not a fact, until the server answers.** The banner drops
on the tap — a wallet prompt must never stand between somebody and the door — but
the optimistic state is `UNKNOWN`, not `EXITED`. Writing `EXITED` hid the banner
_and_ resolved the mode to `REAL`, which handed the real-money executor to a
wallet the server still had in Simulation: one round trip wide on a good day, and
unbounded on a signature that was never given. `liveMode` folds the in-flight
departure in, so the screen may act on the request while execution may not.

The previous routing fact is captured in the mutation context and, on failure,
**restored** rather than re-fetched: the commonest failure is a missing or
rejected signature, and a re-read in that state has no session either — it would
return null, read as Real Mode, and confirm the very thing the rollback was
undoing. The departing flag clears in `onSettled`, so it lifts only once the
server has answered either way.

## Idempotency

The key is scoped `(wallet, idempotency_key)` — a key is a client value, so one
person's cannot refuse another's order — and paired with a `request_fingerprint`
so the same key carrying a _different_ order is rejected rather than replayed.

The check runs **twice**: once before the account lock (cheap, catches the double
tap) and once after it (the case the mechanism exists for — two concurrent
submissions both miss the first check, and without the second the loser collides
with the unique index and fails instead of replaying).

That second check is proved by a genuine three-session test, not by two
sequential calls: a coordinator holds the account row while both callers clear
their pre-lock lookup and park on the lock, and the assertion is that one settles
and the other **replays**. Deleting the post-lock recheck makes it fail with
`duplicate key value violates unique constraint`.

A settled order replays through `simulation_replay_order`, which reads rows and
nothing else. The server calls it **before** any ETH/USD or contract read, so a
retry can never be reported as failed because pricing was briefly unavailable.

## Where things live

| Concern                                             | Owner                                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------- |
| Constants, `formatCC`, lifecycle rules, eligibility | `src/domain/simulation.ts`                                              |
| The 10-conviction count                             | `src/domain/beliefs.ts` (`profileProgressFor`)                          |
| Lifecycle + quote + settlement                      | `src/lib/simulation.server.ts`                                          |
| Public server functions                             | `src/lib/simulation.functions.ts`                                       |
| Query options (mode in every key)                   | `src/lib/simulation-query.ts`                                           |
| The one mode answer                                 | `src/lib/simulation-mode.tsx`                                           |
| Real/Simulation execution facade                    | `src/lib/market-execution.ts`                                           |
| Tables, RPCs, mode columns                          | `supabase/migrations/20260909000000_simulation_mode.sql`                |
| Lifecycle reconciliation, audience predicate        | `supabase/migrations/20260910000000_simulation_lifecycle_reconcile.sql` |
| The boundary, asserted closed                       | `src/lib/simulation-boundary.test.ts`                                   |
| Departure and the real preflight, run               | `src/lib/simulation-departure.test.ts`                                  |
| The transactional claims, on a real cluster         | `src/lib/simulation.pg.test.ts` (`npm run test:pg`)                     |

The first migration is already applied, so every later schema change is a **new
file** rather than an edit to it. `20260910…` replaces `simulation_graduate`
in place and adds `simulation_reconcile_state` and
`simulation_reachable_wallets`.

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

**A real order re-asks the server which ledger owns the wallet, immediately
before delegating.** The routing cache cannot be the last authority for real
money: Simulation is wallet-global on the server, so a second tab or another
device can activate it while this one is inside its fresh window.
`refetchOnWindowFocus: "always"` and `staleTime: 0` narrow that window; they
cannot close it, and "narrow" is not a property to trust with somebody's money.

`useRealGuard` fetches the routing fact, writes the fresh answer back into the
cache, and permits the trade only for a confirmed `null` / `EXITED` /
`GRADUATED` (`routingPermitsRealOrder`); `ACTIVE` and `GRADUATING` refuse before
the wallet is ever opened. The guard is welded to the real adapter's `buy` and
`sell` inside the facade — **not** inside `chain-trade.ts`, which is the real
execution path and goes on knowing nothing about Simulation. It is one request on
the path of a real trade, on the same path that already re-reads the contract
quote at signing time, and for the same reason: the number on screen is old by
the time somebody presses the button.

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

An account carries a persisted lifecycle state — `ACTIVE`, `GRADUATING`,
`EXITED`, `GRADUATED` — rather than a boolean plus a client-side derivation. The
order transaction writes `GRADUATING` in the same transaction as the tenth
conviction, so there is no window in which somebody is finished but still
reachable by a Challenge they cannot answer. For convictions that arrive from
outside Simulation there is no such transaction, which is why the audience
predicate re-derives the count rather than trusting the stored state, and why
`simulation_reconcile_state` exists to move it in both directions.

Leaving (by either door) closes outgoing Simulation Challenges **and** deletes
their unanswered recipient rows — `buildChallenges` reads `market_calls`
directly and never joins back to the parent, so closing only the parent would
leave other people still being asked. It then reconciles any Challenge those
deletions emptied, because a Challenge reaching nobody holds an editorial slot
forever.

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
active-slot indexes — and `market_calls`' **primary key carries the mode**. With
the three-column key, a real call between two people on a market made the
Simulation call between the same two people impossible, and `ON CONFLICT … DO
NOTHING` turned that into silence: the audience write dropped the person and the
Challenge reached one fewer than it reported. The mode column would have been a
label on whichever row was written first.

The whole order — eligibility, balance, ledger, position, belief, match refresh,
answered calls — is one transaction (`simulation_execute_order`), with the
account row locked and eligibility re-read inside the lock.

## Challenge

Challenge remains a **social call**, not a wager. It never spends, transfers or
locks CC. The Simulation audience is:

```
existing eligible audience  INTERSECT  simulation_reachable_wallets(…, 10)
```

An intersection, never a second matching algorithm. An empty audience omits the
action rather than rendering it disabled. `ACTIVE` and not merely "has an
account": a `GRADUATING` user can no longer answer, so putting them in an
audience would ask somebody for something they are forbidden from giving.

The predicate is a **function**, not a filter in the application, and it asks the
question the product actually means — _can this person answer a Simulation
Challenge right now?_ — which is `state = 'ACTIVE'` **and** still below the
target. The stored state alone is one reconciliation behind whenever a conviction
arrives from outside Simulation (a real position the indexer writes, a belief
recorded elsewhere): no Simulation transaction runs for those, so nothing moved
the account, and a server-side audience cannot see the client's derivation. It is
SQL rather than a PostgREST filter because the count is SQL, and expressing it in
the application would mean a round trip per candidate.

The audience also excludes anyone who has **already answered this market in
Simulation**. `wallet_beliefs` finds real participants and cannot see a Simulation
position, so without a second read against `simulation_positions` somebody could
be asked a question they had already answered. Row existence is the test, not
positive shares — selling out does not un-answer, which is the rule the real read
already follows.

### Where the mode line falls — and where it deliberately does not

This is an explicit decision, not an accident of which functions took a
parameter.

**Mode-scoped — anything that decides who gets contacted, or what is owed.**
A wrong answer here reaches a real person: it puts a question on somebody's rail
that they have no way to close, or contacts somebody in a ledger they are not in.

- `buildChallenges` — the open queue
- `eligibleAudience`, `audienceFor`, `callReachFor` — who can be asked, and the
  count shown before asking
- `answeredCandidates` — the "we have answered each other before" door **into**
  an audience
- `put_on_table`, `passCall`, `tableFor` — the writes and the capacity
- `markCallsAnswered` — a real position never closes a Simulation call, and the
  order transaction's `mode = 'SIMULATION'` predicate is the other half

**Not mode-scoped — retrospective relationship history.**
`callsWithPerson`, `dependabilityFor` and `challengeHistory` describe what two
people have actually done. Splitting them would fragment one relationship into
two half-histories on a profile that shows one person, and Simulation is a few
weeks of somebody's first month — not a separate social identity. Dependability
already excludes passes and never reads a side; it counts showing up, which is
equally real in either ledger.

The line, stated once: **audience reads are scoped, history reads are not.**

## House

The House's _prediction_ is shared — its read of a person is the same read in
either ledger, and looking at it consumes nothing. The _round_ is not: a real
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
