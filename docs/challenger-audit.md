# CHALLENGER — reciprocity, belonging & history audit

**Status: audited, then Phases 0–3 built. See [§N — what shipped](#n-what-shipped)
for the implementation log, including two places where the audit's own
recommendation was wrong and was reversed on closer reading.**

Everything below is read from the repository at `1cbd86f`. Where a claim could not be
verified against production data, it says so rather than guessing — the corpus counts
requested in §22.D/E/F and §15 are **not obtainable in this environment**, for a reason
documented in [§0](#0-what-could-not-be-measured-and-why).

---

## 0. What could not be measured, and why

`challenges` and `market_calls` are `ENABLE ROW LEVEL SECURITY` with **no policy** and
`GRANT ALL … TO service_role` only. This session has `SUPABASE_PUBLISHABLE_KEY` and no
service-role key.

Measured just now against production:

| table                    | HTTP | result                                |
| ------------------------ | ---- | ------------------------------------- |
| `challenges`             | 200  | `[]` — RLS filtering, not emptiness   |
| `market_calls`           | 200  | `[]` — RLS filtering, not emptiness   |
| `wallet_beliefs`         | 401  | permission denied                     |
| `viewer_dna_cache`       | 401  | permission denied                     |
| `profiles`               | 401  | permission denied                     |
| `markets`                | 206  | readable                              |
| `market_state`           | 206  | readable                              |
| `events`                 | 206  | readable                              |
| `market_state_snapshots` | 500  | `57014` statement timeout (2.4M rows) |

`npm run check:challenge` confirms it in its own words:

```
CALLS  (outcomes)          COULD NOT READ — this section is unknown, not zero.
RELATIONSHIPS              COULD NOT READ — this section is unknown, not zero.
NOT READ WITH THIS KEY     · market_calls — needs SUPABASE_SERVICE_ROLE_KEY
```

`scripts/check-challenge-integrity.ts` **refuses to run at all** without the service key,
and its own header explains why in exactly the terms this brief demands: a 200-with-empty-array
is the confident zero this codebase keeps paying for.

**So: sections D, E, F and the §15 corpus distribution are blocked on `SUPABASE_SERVICE_ROLE_KEY`.**
Every question they ask is already answerable by the two scripts that exist. Give me the key
(or run them yourself) and I will fill the numbers in; I will not fabricate them, and I will not
recommend a §15 evidence threshold without seeing the distribution.

One thing the codebase itself already suspects, worth stating: `src/lib/open-calls.ts:110`
records that a blocked service-role read is _"the leading explanation for `market_calls`
holding zero rows while supply exists"_. Before any of this is built, **the first question to
answer is whether the ledger has rows at all.** If `market_calls` is empty in production, every
proposal below has no fuel and the real work is upstream.

---

## A. Current Challenger architecture

There is **one** challenge system. It is already two-tabled and single-resource, and the
architecture is better than the brief assumes.

```
                     ┌──────────────── DATA ─────────────────┐
challenges           ONE ROW PER (challenger, market)   the thing put on the table
  id, challenger_wallet, market_id, slot_no 1..3,
  created_at, closed_at, close_reason ∈ {creator, all_responded}
  UNIQUE (challenger_wallet, slot_no)  WHERE closed_at IS NULL   ← the cap, in the DB
  UNIQUE (challenger_wallet, market_id) WHERE closed_at IS NULL  ← one market, one slot

market_calls         ONE ROW PER RECIPIENT             the relationship ledger
  PK (market_id, caller_wallet, responder_wallet)
  relation_at_call (frozen), called_at, responded_at, passed_at, challenge_id → challenges.id
                     └───────────────────────────────────────┘
                                      │
┌──────────────── DOMAIN (zero IO, pure) ─────────────────────────────────────┐
│ src/domain/challenge.ts     composeChallenges, reasonFor, challengeLock,     │
│                             CHALLENGE.{maxOpen:6, unlockAt, windowDays:30}   │
│ src/domain/table.ts         TABLE_SLOTS=3, recipientState, tableProgress,    │
│                             shouldAutoClose, progressLine, finishedLine,     │
│                             tableLine, FINISHED_WINDOW_MS=7d, TABLE_BANNED   │
│ src/domain/dependability.ts CallFact, Tally, tally, bucketOf, rungFor,       │
│                             bondFor, historyRows, showedUpFor,               │
│                             showedUpInMarket, BANNED_UI_WORDS                │
│ src/domain/call-line.ts     the one sentence a challenge card may say        │
│ src/domain/scene.ts         World → challengerView/challengedView/checkWorld │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
┌──────────────── SERVER (service-role) ──────────────────────────────────────┐
│ src/lib/challenge.server.ts  qualifiedCallers, buildChallenges,              │
│                              markCallsAnswered, callReachFor,                │
│                              callsWithPerson → PairCalls, dependabilityFor,  │
│                              showedUpForMe, titlesFor                        │
│ src/lib/table.server.ts      putOnTable, takeOffTable, passCall, tableFor,   │
│                              activeRows/activeCount, tableCandidates         │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
┌──────────────── SERVER FUNCTIONS ───────────────────────────────────────────┐
│ challenge.functions.ts  getChallenges (unsigned), getCallsWithPerson,        │
│                         getDependability, getCallReach, answerCalls (POST)   │
│ table.functions.ts      getTable, getTableCandidates, putOnTable*,           │
│                         takeOffTable*, passOnCall*     (* signed)            │
└──────────────────────────────────────────────────────────────────────────────┘
                                      │
┌──────────────── CLIENT ─────────────────────────────────────────────────────┐
│ src/lib/open-calls.ts       useOpenCalls (single source of the count),       │
│                             hideCall / useHiddenCalls (localStorage)         │
│ src/hooks/useAnswerCalls.ts confirmed buy → answerCalls, retry×3,            │
│                             parks closed callers at closedCallsKey(marketId) │
│ src/components/ChallengeRail.tsx   the rail: tabs, lock, "Challenged You"    │
│ src/components/YourTable.tsx       "You Challenged" + picker + overflow      │
│ src/components/PutOnTable.tsx      post-order CTA                            │
│ src/components/LaunchRail.tsx      "You showed up for Maya."                 │
│ src/components/PersonProfile.tsx   "Between you" pair history                │
│ src/components/NetworkPanel.tsx    bondFor per person card                   │
│ src/routes/index.tsx:704,1778      mobile badge + rail mount                 │
│ src/routes/lab-9f3c7a21b4.tsx      real components against a fixture World   │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Right-rail hierarchy as it stands today** (`ChallengeRail.tsx`):

```
ChallengeRail
├── tablist  [ Challenge (n) | Insider (n) ]
├── tab=insider → {insider}  (LiveTape, passed in as a node, stays mounted)
└── tab=challenge
    ├── !wallet        → "Connect a wallet to see who wants you at the table."
    ├── lockUnknown    → "Could not load your people…"
    ├── !lock.unlocked → <LockedPanel/>  (5 dots)
    └── unlocked
        ├── failed → "Could not load who is waiting on you…"
        ├── ● amber  CHALLENGED YOU        ← var(--no)
        │   └── <ChallengeRow>  × open.slice(0, shown)
        │        avatar · name · TRIBE/RIVAL badge
        │        title
        │        c.reason               (call-line)
        │        82% Conviction Match · 9 of 11 together
        │        [×] pass, absolutely positioned
        ├── <YourTable>
        │   ├── ● blue  YOU CHALLENGED  live/3  ⌄     ← var(--yes)   [Add]
        │   ├── <TablePicker>  (suggestions ⇄ search, one surface)
        │   └── <TableRowCard> × [live…, ended(all_responded)…]
        │        title
        │        progressLine | finishedLine
        │        [⋯] → "Take off the table"
        └── "{n} more waiting"   ← paginates by CHALLENGE.maxOpen
```

---

## B. Current state model — observed vs inferred

**Observed** (traced to a line of code):

| Event                                        | What actually happens                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I issue**                                  | `putOnTable` resolves `qualifiedCallers` → if empty, `{ok:false,'no_audience'}` and **no slot spent**. Otherwise walks slots 1→3 inserting into `challenges`; the partial unique index _is_ the allocator (`table.server.ts:95-124`). Then one `market_calls` row per audience member with `relation_at_call` frozen and `challenge_id` set.                                                                                                                                           |
| **Recipient sees it**                        | Nothing is written. `buildChallenges` reads `market_calls` where `responder_wallet = me AND challenge_id IS NOT NULL AND responded_at IS NULL AND passed_at IS NULL`, joins `markets.title`, joins **current** `wallet_beliefs.stance_side` for the caller, joins live `viewer_dna_cache` for the pair record, then `composeChallenges` collapses to **one card per market, strongest relation wins**.                                                                                 |
| **Recipient takes the same side**            | `useAnswerCalls` fires on confirmed buy → `answerCalls` → `markCallsAnswered`. Server **proves** the position (`tookAPosition`: canonical `wallet_beliefs` stance _or_ a canonical `events` trade) before stamping; unprovable returns `pending:true` and retries 3× with backoff. `responded_at` is stamped on **every** open call in that market, for **all** callers. Returns the closed callers → parked at `closedCallsKey(marketId)` → `LaunchRail` prints `showedUpFor(names)`. |
| **Recipient takes the opposite side**        | **Byte-for-byte identical.** `RecipientFact` has no `side` field. This is enforced structurally, not by discipline (`domain/table.ts:78-90`, `domain/dependability.ts:62-68`).                                                                                                                                                                                                                                                                                                         |
| **Recipient passes**                         | `hideCall(marketId)` → localStorage, card leaves instantly. Fire-and-forget `passOnCall` (signed, non-interactive) → `passCall` sets `passed_at` on **every** open call for that responder in that market. Never touches `responded_at`. Creator sees an aggregate count only.                                                                                                                                                                                                         |
| **Recipient dismisses**                      | Same thing. **There is no separate dismiss.** Dismiss _is_ pass — one `×`, one local hide, one durable `passed_at`.                                                                                                                                                                                                                                                                                                                                                                    |
| **Market resolves**                          | **Nothing.** No resolution/settlement path touches `challenges` or `market_calls`. `close_reason` has exactly two values and neither is "market resolved".                                                                                                                                                                                                                                                                                                                             |
| **I challenge the same person/market again** | _See F — this is where the real defect is._                                                                                                                                                                                                                                                                                                                                                                                                                                            |

**Inferred / unverified:**

- That `market_calls` has rows in production at all (§0).
- That the indexer lag `useAnswerCalls` retries against is actually within 3 attempts × 4s/8s/16s.
- Nothing observes whether a recipient ever _saw_ a card. `RecipientState` has a `"viewed"`
  member that no code path can ever produce — it is dead vocabulary.

### B.1 §2 is already satisfied — there is no Accept

This is the most important finding of the state-model section: **the brief's §2 correction has
already been made in this codebase, deliberately, and is locked by tests.**

- `domain/table.ts:249-263` — `TABLE_BANNED` contains `"accepted"`, `"accept"`, `"invite"`,
  `"invited"`, plus `"declined"`, `"rejected"`, `"ignored"`.
- `components/challenge-card.test.ts:74-80` — _"has no Accept and no Decline"_, asserted as
  `expect(rail()).not.toMatch(/Accept|Decline|Reject|Ignore/i)`.
- `components/put-on-table.test.ts:65` — bans `agree`, `invite`, `accept`, `credits`, `allowance`.
- `ChallengeRail.tsx:316` — _"An Accept button. Opening is not accepting — TAKING A SIDE is."_

Grep for `accept` across `src/` returns **zero** occurrences in Challenger UI, copy, state,
events or mutations. The only hits are unrelated (`<input accept="image/*">`, ETH slippage,
terms-of-service).

The current semantic model already **is** `challenged → took_side | passed | waiting`:

| Brief's model | Existing fact              | Source                              |
| ------------- | -------------------------- | ----------------------------------- |
| `took_side`   | `responded_at IS NOT NULL` | `market_calls.responded_at`         |
| `passed`      | `passed_at IS NOT NULL`    | `market_calls.passed_at`            |
| `waiting`     | both NULL                  | `recipientState()` returns `"open"` |

**No new statuses are needed, and none should be created.** The one piece of vocabulary that
should go is `RecipientState = "viewed"` — unreachable, and the only member that implies a
workflow step.

### B.2 Defects found in the current state model

Three real ones, in severity order.

**B.2.1 — A re-issued Challenge silently reaches nobody. (correctness, blocks §13)**

`table.server.ts:129-144` inserts the whole audience in **one** statement and swallows `23505`:

```ts
const { error: callsErr } = await sb.from("market_calls").insert(
  audience.map(([responder, caller]) => ({ market_id, caller_wallet: me, responder_wallet: responder, … })),
);
if (callsErr && callsErr.code !== CONFLICT) { console.error(…) }
```

A multi-row `INSERT` is **atomic**. `market_calls`'s PK is `(market_id, caller_wallet, responder_wallet)`
with **no `closed_at` predicate** — it is unique _forever_, not per-challenge. So:

1. I put market 42 on the table → 8 `market_calls` rows written.
2. I take it off the table (`closed_at` set — the active-market index no longer blocks me).
3. I put market 42 back on the table → new `challenges` row, slot allocated.
4. The audience insert hits the PK on **all 8** rows → `23505` → **entire batch rolls back** →
   swallowed by the `!== CONFLICT` guard.

Result: a `challenges` row with **zero** recipients. `tableProgress` → `reached: 0` →
`progressLine` returns `null` (no line at all), `allResponded` is `false` by design, so
`shouldAutoClose` never fires. **The slot is occupied permanently**, the card is silent, and
one of three editorial slots is gone until the creator manually takes it down.

The same failure occurs with _partial_ overlap: challenge market 42 to an 8-person audience,
close it, gain a 9th qualified person, re-issue → the 9th person's row is lost along with the
other 8, because one statement.

**B.2.2 — `CHALLENGE.windowDays` is documented as shared and is not applied on the read path.**

`domain/challenge.ts:130-139` says the 30-day window exists precisely so _"three things must
agree on it: what the rail derives, which calls are still waiting, and what the showing-up
denominator counts"_, and warns that a server-only constant _"meant a profile could show
someone waiting on a call their caller can no longer see."_

`buildChallenges` (`challenge.server.ts:147-155`) applies **no** `called_at` filter. Meanwhile
`bucketOf` (`dependability.ts:330-334`) buckets anything older than 30 days as `outOfReach`, and
`callsWithPerson:485` drops it from the pair timeline entirely.

So today a 90-day-old open call **is** in the rail, **is not** in the pair history, and **is not**
in any denominator. The exact drift the constant was written to prevent, in the opposite
direction from the one it feared.

**B.2.3 — Pass and answer are market-scoped, not challenge-scoped.**

`passCall(wallet, marketId)` and `markCallsAnswered(wallet, marketId)` both key on
`(market_id, responder_wallet)` and hit **every** caller's row. For _answering_ this is right:
taking a side genuinely answers everyone who asked. For _passing_ it is a stronger claim than
the UI collected — `composeChallenges` shows the reader **one** card per market (strongest
relation wins), so dismissing Sarah's card also records a pass against Mike, whose card the
reader never saw. Mike's creator-side count says "1 passed" about a question this person was
never shown by him.

Not urgent, but it means **pass counts are not per-challenge-honest**, which matters the moment
§10 wants to end a reciprocity run on a pass.

---

## C. Data derivability matrix (§20)

`CURRENT` = derivable today, no schema change. `EXTEND` = derivable from existing tables but the
current query does not select it. `NEW` = requires persistence that does not exist.

| UI fact                           | Canonical source                                                                   | Derived?                                                                                            | Safe?                                                                                                                                                                                                                                                                   |
| --------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| challenger                        | `market_calls.caller_wallet` → `resolveProfiles`/`aliasFor`                        | CURRENT                                                                                             | ✅                                                                                                                                                                                                                                                                      |
| recipient                         | `market_calls.responder_wallet`                                                    | CURRENT                                                                                             | ✅                                                                                                                                                                                                                                                                      |
| market / question                 | `markets.title` via `titlesFor`                                                    | CURRENT                                                                                             | ✅ — row dropped if title missing                                                                                                                                                                                                                                       |
| challenger side                   | `wallet_beliefs.stance_side` (**live, not frozen**)                                | CURRENT                                                                                             | ⚠️ present tense only. A caller who flipped is quoted with today's side. Fine for an open card; **wrong for history.**                                                                                                                                                  |
| recipient side                    | `wallet_beliefs.stance_side` for the responder                                     | EXTEND (one `.in()` — the query already runs for the caller)                                        | ⚠️ same present-tense caveat                                                                                                                                                                                                                                            |
| waiting                           | `responded_at IS NULL AND passed_at IS NULL`                                       | CURRENT                                                                                             | ✅                                                                                                                                                                                                                                                                      |
| passed                            | `passed_at IS NOT NULL`                                                            | CURRENT                                                                                             | ⚠️ market-scoped, see B.2.3                                                                                                                                                                                                                                             |
| took a side (showed up)           | `responded_at IS NOT NULL`, server-proved                                          | CURRENT                                                                                             | ✅ strongest fact in the system                                                                                                                                                                                                                                         |
| same / opposite **now**           | compare the two `stance_side` values                                               | EXTEND                                                                                              | ⚠️ **drifts.** Both sides are mutable.                                                                                                                                                                                                                                  |
| same / opposite **at the time**   | —                                                                                  | **NEW**                                                                                             | ❌ nothing freezes a side. `events` could reconstruct it (canonical trade, `side`, `occurred_at`) but that is an unbounded scan per pair per market and this codebase's own rule is _"none of these paths may become a graph traversal"_ (`challenge.server.ts:19-21`). |
| challenge issued at               | `challenges.created_at` / `market_calls.called_at`                                 | CURRENT                                                                                             | ✅                                                                                                                                                                                                                                                                      |
| response timestamp                | `market_calls.responded_at`                                                        | CURRENT                                                                                             | ✅                                                                                                                                                                                                                                                                      |
| pass timestamp                    | `market_calls.passed_at`                                                           | CURRENT                                                                                             | ✅                                                                                                                                                                                                                                                                      |
| challenge closed / why            | `challenges.closed_at`, `close_reason`                                             | CURRENT                                                                                             | ✅ two reasons only; **never "resolved"**                                                                                                                                                                                                                               |
| people on the market **now**      | `market_state.directional_believers`, `believers_yes/no`                           | CURRENT                                                                                             | ✅                                                                                                                                                                                                                                                                      |
| people on the market **before**   | `market_state_snapshots(captured_at, believers_yes, believers_no)`                 | EXTEND                                                                                              | ⚠️ **snapshot cadence, not event-exact.** Table is 2.4M rows and timed out on a bare read. A snapshot may not exist near `responded_at`.                                                                                                                                |
| people on the market at exactly T | `events` canonical directional trades, distinct wallets, `occurred_at ≤ T`         | **NEW query**                                                                                       | ❌ exact but an unbounded per-market scan. `wallet_beliefs.directional_since ≤ T` is cheap but **undercounts** — it only sees people still directional today, and resets on re-entry (`conviction-whale.server.test.ts:78`).                                            |
| capital before/after              | `market_state.capital_held_*`, snapshots                                           | EXTEND                                                                                              | ⚠️ same cadence caveat, **and explicitly forbidden today** — see §7 conflict                                                                                                                                                                                            |
| reciprocity run (pair)            | `market_calls` both directions, ordered by `called_at`, `responded_at`/`passed_at` | EXTEND (`callsWithPerson` already reads both directions; needs `passed_at` added to `CALL_COLUMNS`) | ✅ **fully derivable, no new persistence**                                                                                                                                                                                                                              |
| "showed up for each other"        | `rungFor(theirs, yours) === "each_other"`                                          | CURRENT                                                                                             | ✅ already shipped in `NetworkPanel`                                                                                                                                                                                                                                    |
| shown-up rate                     | `rateFor(tally)`, gated at `minForScore: 5`                                        | CURRENT                                                                                             | ✅                                                                                                                                                                                                                                                                      |
| historical same-side rate         | needs frozen sides                                                                 | **NEW**                                                                                             | ❌ **cannot be built honestly today** — see §15                                                                                                                                                                                                                         |
| duplicate active challenge        | `challenges_active_market_idx`                                                     | CURRENT                                                                                             | ⚠️ per (challenger, market) only; says nothing about the person-pair, and is defeated by B.2.1 after a close                                                                                                                                                            |
| pair interaction count            | `count(market_calls)` both directions                                              | CURRENT                                                                                             | ✅                                                                                                                                                                                                                                                                      |
| repeat market × pair              | `market_calls` PK makes this **impossible by construction**                        | CURRENT                                                                                             | ✅ (and see F)                                                                                                                                                                                                                                                          |

**The single most consequential row in this table: there is no frozen side anywhere.**
`market_calls` deliberately has no side column, and `domain/dependability.ts:62-68` states that
the absence _is_ the enforcement mechanism for "showing up is never agreement". Every piece of
copy in the brief that says _same side / opposite side / again / first time you've split /
didn't see that coming_ depends on a fact this system chose not to keep.

---

## D. History audit

**Blocked on the service key** (§0). What I can state without it, from the schema:

**Reconstructable in principle, from `market_calls` + `challenges` + `markets`:**

- ✅ challenges I issued — `challenges WHERE challenger_wallet = me` (all of them, no window)
- ✅ challenges issued to me — `market_calls WHERE responder_wallet = me`
- ✅ waiting — both stamps NULL
- ✅ recipient took a position — `responded_at`
- ✅ passed — `passed_at`
- ✅ who challenged whom, and when — caller/responder/`called_at`
- ✅ market/question — `markets.title`
- ✅ repeated challenge interactions between the same two people — count both directions
- ⚠️ "completed" — exists only as `close_reason ∈ {creator, all_responded}`. **There is no
  market-resolution concept in Challenger.** Do not print "completed"; print what actually
  happened (`finishedLine` already does).
- ⚠️ resulting market state — current state yes, state-at-the-time only via snapshots
- ❌ what side each person held **at the time** — not stored
- ❌ same or opposite **at the time** — not stored

**The one structural gap in "complete history": `tableFor` is windowed.**
`table.server.ts:225-231` reads `closed_at IS NULL OR closed_at >= now-7d`, and
`FINISHED_WINDOW_MS` is deliberately 7 days with a long comment explaining that _"an outcome you
have to file away is an inbox."_ That reasoning is right for the **rail**, and wrong for a
**complete history** — the brief's §4 requires reaching everything. The rows still exist; only
the read is windowed. This is a **DERIVE**, not a schema change.

Corpus counts to fill in (run with the service key):

```
npm run check:challenge              # participation funnel, called → answered
npm run check:challenge-integrity    # per-claim falsification against the ledger
```

Both already page past Supabase's silent 1000-row truncation and both refuse to report a
blocked read as zero.

---

## E. Reciprocity audit

**Can a person-pair back-and-forth run be computed with no new persistence? Yes.**

Everything needed is already in `market_calls` and already read in both directions by
`callsWithPerson` (`challenge.server.ts:439-454`, using the two existing indexes
`market_calls_caller_idx` and `market_calls_responder_idx`). The only change is selecting
`passed_at`, which `CALL_COLUMNS` currently omits.

The derivation, in the brief's own terms:

```
pair events = market_calls where (caller=me,responder=them) ∪ (caller=them,responder=me)
              ordered by called_at ascending

for each event:
  responded_at != null  →  the challenged person showed up   → run += 1
  passed_at    != null  →  the challenged person passed      → run ends
  both null             →  still waiting                     → run pauses, does not break
```

This satisfies every constraint in §9 **structurally**, not by convention:

| §9 requirement                                   | Why it holds                                                                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| belongs to the person-pair                       | the query is keyed on exactly two wallets                                                                                   |
| advances when the challenged person takes a side | `responded_at` is the only advancing stamp                                                                                  |
| does not care whether they agreed                | there is no side column to look at — enforced by schema                                                                     |
| does not advance from issuing                    | a row with both stamps NULL contributes nothing                                                                             |
| not manufactured by passive market activity      | `markCallsAnswered` only stamps rows that already exist, and only after `tookAPosition` **proves** the position server-side |
| not a global app streak                          | there is no per-wallet aggregate anywhere in the path                                                                       |
| not calendar days                                | `called_at` is used for ordering only, never for bucketing                                                                  |

**Alternation.** §9's examples alternate direction. A one-way chain (me→Maya ×4, all answered)
is a _pattern_, not a _back & forth_ — and the codebase already has the right word for the
distinction: `rungFor` returns `"each_other"` only when both directions have ≥1 answer
(`dependability.ts:171-179`). Recommendation: **compute the run length from the chain, but only
call it "back & forth" when `rung === "each_other"`.** One-way runs get the existing
`"shows up for you"` / `"count on"` sentences, which already exist and already ship.

**Best run.** Derivable — it is the longest chain in the same ordered list, no persistence
needed. Whether it is worth showing is a product call; §18 argues against, and I agree.

**I cannot show real sequences.** §0. The derivation is a ~25-line pure function over data
`callsWithPerson` already returns; it belongs in `domain/dependability.ts` beside `tally`.

### E.1 The blocking conflict: this codebase has _banned_ streaks, twice, on purpose

This is the one place where the brief contradicts a decision the code states explicitly and
locks with tests. I am not overriding it without your call.

- `domain/table.ts:249-263` — `TABLE_BANNED` includes **`"streak"`**, asserted by
  `domain/table.test.ts` → _"bans the mechanics this product decided not to have"_.
- `domain/table.ts:34-36` — _"There is no timer, no reset, no minimum, no streak."_
- `domain/dependability.ts:36-38` — _"Also no streaks, no currency, no XP, no reciprocity
  penalty — the relationship is the reward."_

The brief's §9 reasoning is sound and different from what was banned: what was banned is a
**daily-login streak** (a gamified engagement metric); what §9 wants is a **compressed
reciprocal history** (two real people, real responses, no calendar). Those are genuinely
different objects.

**Recommendation:** keep the ban on the _word_ and build the _fact_. `TABLE_BANNED` policing
`"streak"` is exactly right — the surface should say **"5 back & forth"**, never "5 streak", and
never a flame. That way the existing test keeps its teeth and the new fact ships. If you want
the word too, say so and I will change the ban and its test as an explicit, commented reversal
in the style this codebase uses for reversals (see the `passed_at` migration comment, which
reverses an earlier decision and says so at length).

---

## F. Duplicate audit

**Real examples: blocked on the service key.** What the schema guarantees without it:

| Duplicate shape                                            | Prevented?        | By what                                                                                                                                                                                                                                      |
| ---------------------------------------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Same person puts the same market up twice while it is open | ✅                | `challenges_active_market_idx` — partial unique, so a second tap collides at the DB, and `putOnTable:115-122` distinguishes it into `reason: "already_up"`. `PutOnTable.tsx:73` renders "On the table." instead of a button that would fail. |
| Same person exceeds 3 open Challenges                      | ✅                | `challenges_active_slot_idx` — the loop _is_ the allocator, not a retry (`table.server.ts:81`)                                                                                                                                               |
| Same caller → same responder → same market, ever           | ✅ (too strongly) | `market_calls` PK. **Forever**, with no `closed_at` predicate.                                                                                                                                                                               |
| Same person re-issues the same market after closing        | ⚠️ **broken**     | Allowed by the challenges index, then destroyed by the `market_calls` PK — see **B.2.1**. The Challenge exists with zero recipients and never closes.                                                                                        |
| Two different people challenge me on the same market       | ✅ by design      | PK includes the caller. `composeChallenges` collapses to one card, strongest relation wins. Both rows get stamped when I act.                                                                                                                |

**On §13's proposed invariant** — `ONE UNRESOLVED CHALLENGE PER PERSON-PAIR × MARKET × CONVICTION STATE`:

The first three components already exist and are enforced by the `market_calls` PK, which is a
_stronger_ key than the brief asks for (it is unconditional, not "unresolved"). The fourth,
`CONVICTION STATE`, **cannot be expressed from current data.** The only candidate columns are
`wallet_beliefs.stance_side`, `last_directional_side` and `directional_since` — all mutable
present-tense fields on the challenger, none of them versioned, and `directional_since` resets on
re-entry. There is no way to say "this is a _new_ conviction state" without persisting the
conviction state the challenge was issued under.

**Recommendation:** do **not** implement the conviction-state dimension. Fix B.2.1 instead
(`ignoreDuplicates` on the audience insert, so a re-issue writes the genuinely new recipients and
keeps the old rows' frozen `relation_at_call` untouched — which is what the swallowed-`23505`
comment already intended). That gives you the brief's invariant minus a dimension the data cannot
support, and it turns a permanently-stuck slot into working behaviour.

---

## G. Right-rail audit

The rail is already the right shape. It answers _"who showed up for me?"_, not _"what is
happening?"_, and the separation is load-bearing: `ChallengeRail.tsx:4-12` states it, the tape is
**passed in as a `ReactNode`** rather than owned, and `rail-stability.test.ts` guards the
geometry. Nothing here needs a new architecture.

Where each brief element fits, using components that already exist:

| Brief element                          | Where it goes                                                                                                                                                                                                                                                                                                                                                                                                                   | Classification                            |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **A. current/open challenges**         | already there — the amber `Challenged You` section                                                                                                                                                                                                                                                                                                                                                                              | REUSE                                     |
| **A. my open challenges**              | already there — `YourTable`'s blue `You Challenged` section                                                                                                                                                                                                                                                                                                                                                                     | REUSE                                     |
| **B. recent responses**                | **the gap.** An answered call vanishes: `buildChallenges` filters `responded_at IS NULL`, and `ChallengeRail.tsx:52` states the intent — _"a queue with completed items in it is a to-do list."_ The reverse fact currently escapes to the Insider tape (`insider/build.server.ts:966-1030`) and to `LaunchRail`. This is the one genuinely missing surface.                                                                    | EXTEND                                    |
| **C. completed/past interactions**     | `YourTable` already renders `ended` rows (`close_reason === "all_responded"`) with a dashed border for 7 days                                                                                                                                                                                                                                                                                                                   | REUSE + widen the window behind "See all" |
| **D. reciprocal relationship context** | `bondFor` / `rungFor` already compute it and `NetworkPanel` already renders it; `getDependability` batches it in **two queries for a screenful**                                                                                                                                                                                                                                                                                | REUSE                                     |
| **E. complete history**                | **`PersonProfile`'s "Between you" section already is the per-pair complete history** (`PersonProfile.tsx:278-300`, `historyRows`), reachable by `?p=<wallet>` in the centre column. What is missing is the **cross-person** view.                                                                                                                                                                                               | EXTEND                                    |
| **"See all →"**                        | **Do not invent one.** Two established patterns exist: (1) `CaseFile.tsx:705` — `See all {n} →` opening a portalled full-height bottom sheet (`RosterSheet`, `role="dialog"`, Esc to close, `max-w-[720px]`, own scroll area); (2) `?p=<wallet>` navigating the centre column. **Use (1)** — the sheet is already the answer to "the rail is too small for this list", and it does not displace what the reader was looking at. | REUSE                                     |
| **Streak line**                        | one line under the caller's name on `ChallengeRow`, and one on the pair rows in the history sheet                                                                                                                                                                                                                                                                                                                               | EXTEND                                    |
| **Impact line**                        | see §7 conflict below — **not without a decision**                                                                                                                                                                                                                                                                                                                                                                              | ⚠️                                        |

**Two more reusable pieces worth naming:** `Collapsible` (`grid-template-rows: 0fr→1fr`, no
measurement, honours `motion-reduce`) is what keeps a growing rail from teleporting — anything
added below the fold must use it or `rail-stability.test.ts` is the guard that should catch it.
And `PersonStack` / `PersonAvatar` already carry the face vocabulary, including
`RELATION_RING` mapping tribe→`var(--yes)`, rival→`var(--no)`.

### G.1 §12 — the colour system already does what the brief asks

| Brief                              | Reality                                                                                                                                             | Verdict              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| BLUE = challenges I issued         | `YourTable.tsx:187` — `bg-[var(--yes)]`, heading **"You Challenged"**                                                                               | ✅ already shipped   |
| AMBER = challenges issued to me    | `ChallengeRail.tsx:235` — `bg-[var(--no)]`, heading **"Challenged You"**                                                                            | ✅ already shipped   |
| Drop the word "Live"               | there is no "Live" label on any Challenger surface                                                                                                  | ✅ nothing to remove |
| Prefer "Issued" / "Challenged"     | it says "You Challenged" / "Challenged You" — **better**, because it names the actor                                                                | ✅ leave alone       |
| Completed becomes visually quieter | `YourTable.tsx:341-348` — dashed border, transparent background, muted title, and a comment explaining it _steps back rather than being greyed out_ | ✅ already shipped   |
| Do not introduce new colours       | `--yes: #4c73ff` / `--no: #f5a623` in `styles.css:105-106`, with dark-mode variants                                                                 | ✅ nothing to add    |

`ChallengeRail.tsx:230-233` even states the mapping as a teaching rule: _"amber means somebody is
waiting on you, blue means you are waiting on them."_ **§12 is done. Do not touch it.**

---

## H. Copy audit

Administrative language that should become human-action language — and, more importantly, how
little of it there is. This codebase has already fought this fight; `dependability.ts:353-368`
maintains `BANNED_UI_WORDS` (`dependab`, `lapsed`, `expired`, `response rate`, `reliability`,
`unreliable`, `ignored`, `missed`, `overdue`, `failed`, `notification`, `notified`, `invitation`,
`obligation`) and asserts it across every string the module can emit.

| Current string                                         | Where                         | Verdict                                                                                                                                                                                                       |
| ------------------------------------------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"Waiting on {n}"`                                     | `progressLine`, table.ts:185  | ✅ human already; it names the count, not a status                                                                                                                                                            |
| `"3 of 8 showed up · 1 passed"`                        | `progressLine`                | ✅ facts, no verdict, nobody named as passing                                                                                                                                                                 |
| `"Everyone showed up."` / `"They showed up."`          | `finishedLine`                | ✅ and it refuses the plural flourish at n=1                                                                                                                                                                  |
| `"Quiet one. Not every question finds its people."`    | `finishedLine`, nobody showed | ✅ blames the question, not a person — keep verbatim                                                                                                                                                          |
| `"You took it off the table."`                         | `finishedLine`                | ✅                                                                                                                                                                                                            |
| `"Sarah showed up."` / `"You show up for each other."` | `sentenceFor`                 | ✅ this is exactly the brief's voice, already shipped                                                                                                                                                         |
| `"Waiting on Sarah"`                                   | `historyRows`                 | ✅ already §11's ask                                                                                                                                                                                          |
| **`"Challenged You"` / `"You Challenged"`**            | rail headings                 | ⚠️ correct and directional, but they are _section labels_ doing work the brief wants **cards** to do. Keep the headings; make the cards self-describing so the heading is redundant rather than load-bearing. |
| **`"{n} more waiting"`**                               | `ChallengeRail.tsx:267`       | ⚠️ fine, but it is the current "see all" and it only pages the open queue — it is not history                                                                                                                 |
| **`"On the table."`**                                  | `PutOnTable.tsx:74`           | ⚠️ product voice, not administrative. Keep.                                                                                                                                                                   |
| **`RecipientState = "viewed"`**                        | `domain/table.ts:61`          | ❌ **DELETE.** Unreachable, and the only workflow-shaped word in the model.                                                                                                                                   |
| **`"Could not load who is waiting on you…"`**          | rail failure                  | ✅ keep — and note it earns its place; see `silent-failure.test.ts`                                                                                                                                           |

**What the brief asks for that does not exist yet, in copy terms:**

- `ALEX SHOWED UP / Alex took NO against your YES.` — the headline exists (`showedUpInMarket`);
  the **side clause does not and cannot be honest**, see §7/§14 below.
- `MAYA JOINED YOU` — requires the same missing fact.
- `YOU SHOWED UP FOR JORDAN` — **exists**: `showedUpFor(names)` → `"You showed up for Maya."`,
  rendered by `LaunchRail`. It is currently a one-shot moment; it should also be a persistent row.
- `STILL WAITING ON ALEX` — **exists** as `"Waiting on Sarah"` in `historyRows`; it is on the
  profile, not the rail.
- `ALEX PASSED` — **must not be built as written.** The pass ledger is aggregate by explicit
  design, stated in three places (migration comment, `table.server.ts:176-187`, `YourTable.tsx:23`):
  _"The creator sees it AGGREGATED. '1 passed', not 'Mike passed on you'."_ Naming a passer is a
  reversal of a documented privacy decision, not a copy tweak. Flagging, not doing.

---

## I. Conflicts between the brief and shipped decisions

Five. Each is a decision the code states in prose, defends with reasoning, and in four cases
locks with a test. I need your ruling on the starred ones before writing code.

**★ I.1 — §7 shared-conviction impact vs. the "no market numbers beside a Challenge" rule.**

`domain/table.ts:170-176` and `YourTable.tsx:16-21` both forbid exactly what §7 asks for:

> _"No capital, no believer count: those are market totals, not Challenge effects, and printing
> '+$42' beside a Challenge implies a causal link the data cannot support. The moment this line
> carries four numbers it stops being a social object and becomes an ad-tech panel."_

§7 asks for `6 → 7 people have now taken a side` and pre-empts the objection by demanding
before/after facts rather than causal claims. That is a real distinction — but the shipped rule
is about **implication by adjacency**, not about the sentence's grammar. A believer count printed
next to "Alex showed up" will be read as caused by Alex, whatever the verb.

There is a version that survives both: **scope the impact to the challenge's own audience, where
causality is actually established.** `tableProgress` already computes it, the denominator is
frozen at creation, and the fact is genuinely caused by the asking:

> `3 of 8 showed up` → after Alex answers → `4 of 8 showed up`

That is a before/after the data proves _and_ causes. Market-wide believer counts are neither
(§C: exact historical counts need an unbounded `events` scan; snapshots are cadence-based; and
`market_state_snapshots` timed out on a bare read). **Recommendation: build the audience-scoped
version, do not build the market-wide one.** Tell me if you want the market-wide line anyway and
I will scope the snapshot work.

**★ I.2 — §14/§15 relationship memory vs. the absence of a frozen side.**

_"Same side again"_, _"first time you've split"_, _"Alex has taken the same side as you in 4
previous challenges"_ all require each person's side **as it was**. `market_calls` has no side
column, and `dependability.ts:62-68` says the absence is the enforcement:

> _"`CallFact` carries two timestamps and no side; `market_calls` has no side column; nothing in
> this module's inputs can express one. A future change that wanted to weight by agreement would
> have to add a field to get there."_

Reading today's `wallet_beliefs.stance_side` and calling it history is precisely the drift that
`relation_at_call` was invented to prevent — history would silently rewrite itself every time
somebody flipped.

Three honest options:

1. **Do not build §14/§15.** Ship reciprocity (which needs no side) and belonging (which needs no
   side). Zero new persistence, zero risk. _My recommendation for the first pass._
2. **Freeze the side at response time** — one nullable `responded_side` column on `market_calls`,
   written by `markCallsAnswered` from the value `tookAPosition` already reads. It is a CREATE,
   it is small, it is honest, and it is _the_ unlock for §14. But it puts a side into the ledger
   that three files say must never have one, and history starts from the day it ships — the
   existing corpus can never be backfilled, so "4 previous challenges" is unavailable for months.
3. Reconstruct from `events`. Rejected: unbounded scan, against the module's own stated rule.

**★ I.3 — §9 streaks vs. `TABLE_BANNED` containing `"streak"`.** See E.1. Recommendation: build
the fact, keep the word banned, say **"back & forth"**.

**★ I.4 — §5's `ALEX PASSED` vs. the aggregate-pass privacy decision.** See H. Recommendation:
do not name passers. §10's _"Your 7-challenge run ends here"_ can be said without naming who
ended it — and on the recipient's own rail, the recipient **is** the person who passed, so it is
honest there and only there.

**I.5 — §23's "Challenge history does not run through Insider scoring" vs. today.** It already
does, partially: `showedUpForMe` is imported into `insider/build.server.ts:981` and pushed into
the tape as a `showed_up` story with `payload.significance: 0.9` and a `pace` weight. That is a
deliberate, well-commented decision (aggregated one-row-per-market, `tone: "neutral"` so no side
is implied, `personal: true`). The invariant should be read as _"the new rail history must not go
through the scorer"_ — not as a demand to rip out the tape row, which is a different, working
surface. Not blocking; flagging so the invariant is written accurately.

---

## J. Proposed experience — cards from states the system can actually produce

Every card below is generated **only** from facts marked CURRENT or EXTEND in §C. Anything
needing a frozen side is marked and excluded pending I.2.

**1 · Challenge I issued, waiting** — `challenges` open, `tableProgress.showedUp === 0`

```
● blue
  Will Bitcoin hit $200K before 2027?
  Waiting on 8
```

_Ships today. This is `progressLine` unchanged._

**2 · Challenge sent to me, waiting** — `market_calls` both stamps NULL

```
● amber
  [face] Maya                                    TRIBE
  Will AI replace most software engineers?
  Maya believes YES. Take this one.
  82% Conviction Match · 9 of 11 together
  5 back & forth                                      ← NEW (§E, no new data)
                                                   [×]
```

**3 · Someone showed up for me** — `responded_at` stamped, my rail

```
● amber (quieter)
  [face] Maya
  Will AI replace most software engineers?
  Maya showed up.
  4 of 8 showed up                                    ← audience-scoped impact (I.1)
  6 back & forth
```

_The side clause "Maya took NO against your YES" is **excluded** pending I.2._

**4 · I showed up for someone** — `responded_at` on a call addressed to me

```
● amber (quieter)
  [face] Jordan
  Will the Fed cut before June?
  You showed up for Jordan.
  3 back & forth
```

_`showedUpFor()` already produces this sentence; today it only lives in `LaunchRail`._

**5 · A pass, on the passer's own rail** — `passed_at` stamped, my rail, my choice

```
  Will the Fed cut before June?
  You passed.
  Your run with Alex ends at 7.                       ← honest here, and only here (I.4)
```

**6 · Reciprocal run** — both directions have answers, `rung === "each_other"`

```
  [face] Maya
  You show up for each other.                         ← sentenceFor(), already shipped
  7 back & forth · neither of you has passed
```

**7 · Finished challenge, everybody answered** — `close_reason = "all_responded"`

```
  ⌐ ─ ─ ─ ─ ─ ─ (dashed)
  Will Bitcoin hit $200K before 2027?
  Everyone showed up.
```

_`finishedLine()` unchanged. Today it ages out at 7 days; behind "See all" it should not._

**8 · Nobody answered** — closed, `showedUp === 0`

```
  ⌐ ─ ─ ─ ─ ─ ─
  Will the ETF approve in Q3?
  Quiet one. Not every question finds its people.
```

**9 · Complete history sheet** — `See all {n} →` → `RosterSheet`-shaped portal

```
┌─ Challenges · 41 ──────────────────────────────── × ─┐
│ TODAY                                                 │
│  Maya showed up        Will AI replace engineers?     │
│  You showed up         Will the Fed cut before June?  │
│ THIS WEEK                                             │
│  Waiting on Alex       Will $DEGEN hit $0.10?         │
│  Everyone showed up    Will Bitcoin hit $200K?        │
│ EARLIER                                               │
│  …                                                    │
└───────────────────────────────────────────────────────┘
```

_Every label from `historyRows()`, which already emits exactly these three._

**10 · Surprise (§15)** — **not proposable.** Requires I.2 _and_ a corpus distribution I cannot
read (§0). It also needs a minimum-evidence threshold, and this codebase already has the right
precedent for setting one: `DEPENDABILITY.minForScore = 5`, chosen because _"of 6,727 possible
caller→responder pairs, the MEDIAN PAIR SHARES ONE MARKET and only 5% share five or more"_
(`dependability.ts:26-32`). If pair-interaction counts look anything like that, a 1- or 2-pair
threshold would make _"didn't see that coming"_ the most common sentence on the platform. I will
recommend a number when I can see the distribution, not before.

---

## K. Smallest safe implementation

Ordered so each step is independently shippable and independently revertable. Nothing here is a
new resource, a second feed, a second scorer or a duplicated calculation.

### Phase 0 — unblock and repair (do this regardless of the rest)

| #   | Change                                                                                                                                                                                                                                      | Class  | Files                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------- |
| 0.1 | Run `check:challenge-integrity` with the service key; establish whether `market_calls` has rows                                                                                                                                             | —      | scripts (exist)               |
| 0.2 | Audience insert uses `upsert(…, { onConflict: 'market_id,caller_wallet,responder_wallet', ignoreDuplicates: true })` so a re-issue writes the new recipients instead of rolling back all of them. **Fixes B.2.1's permanently-stuck slot.** | EXTEND | `lib/table.server.ts:129`     |
| 0.3 | Apply `CHALLENGE.windowDays` to `buildChallenges` — `.gte("called_at", now-30d)`, closing the drift the constant's own comment warns about                                                                                                  | EXTEND | `lib/challenge.server.ts:147` |
| 0.4 | Delete `RecipientState = "viewed"` and `TERMINAL_STATES`' dependence on it; it is unreachable and it is the last workflow word in the model                                                                                                 | DELETE | `domain/table.ts:61`          |

### Phase 1 — reciprocity, from data that already exists

| #   | Change                                                                                                                                                                                                              | Class  | Files                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------- |
| 1.1 | Add `passed_at` to `CALL_COLUMNS` and to `CallFact`/`factOf`                                                                                                                                                        | EXTEND | `lib/challenge.server.ts:426`, `domain/dependability.ts:80` |
| 1.2 | `backAndForth(events): { run, best, broken }` — pure, beside `tally`, over the merged pair timeline `callsWithPerson` already builds. Advances on `responded_at`, ends on `passed_at`, ignores side by construction | DERIVE | `domain/dependability.ts`                                   |
| 1.3 | Return the run on `PairCalls`; batch it in `dependabilityFor` (already 2 queries for a whole screen)                                                                                                                | EXTEND | `lib/challenge.server.ts`                                   |
| 1.4 | Render `"{n} back & forth"` on `ChallengeRow`, gated on `rung === "each_other"` so one-way patterns keep their existing sentences                                                                                   | EXTEND | `components/ChallengeRail.tsx`                              |
| 1.5 | Tests: a run cannot be manufactured by issuing; a pass ends it; YES and NO advance it identically; `TABLE_BANNED` still rejects the word "streak"                                                                   | —      | `domain/dependability.test.ts`                              |

### Phase 2 — the card transforms instead of vanishing (§16)

| #   | Change                                                                                                                                                                                                                                                                                                                    | Class  | Files                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------ |
| 2.1 | `buildChallenges` also returns calls answered within a short recency window, tagged `state: "waiting" \| "showed_up" \| "passed"` — **one query, one `.or()`, same rows.** The `responded_at IS NULL` filter becomes a field on the row rather than a `WHERE`.                                                            | EXTEND | `lib/challenge.server.ts:147`  |
| 2.2 | `Challenge` gains `state` + `respondedAtMs`; `composeChallenges` keeps waiting rows above answered ones. **`ChallengeRail.tsx:52`'s "a queue with completed items is a to-do list" needs an explicit, commented reversal** — the fix is that an answered row is not a to-do, it is an outcome, and it ages out on its own | EXTEND | `domain/challenge.ts`          |
| 2.3 | `ChallengeRow` renders the transform: same card, same key, `showedUpInMarket()`/`showedUpFor()` for the line, no `×` once terminal                                                                                                                                                                                        | EXTEND | `components/ChallengeRail.tsx` |
| 2.4 | Audience-scoped impact line on my own outbound cards — `progressLine` already produces `4 of 8 showed up` and the denominator is already frozen                                                                                                                                                                           | REUSE  | none                           |

### Phase 3 — complete history

| #   | Change                                                                                                                                                                                                                                                    | Class  | Files                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------- |
| 3.1 | `challengeHistory(viewer, { limit, before })` — one server function unioning the two `market_calls` directions plus `challenges`, **no `FINISHED_WINDOW_MS`**, newest first. Reuses `titlesFor`, `resolveProfiles`, `historyRows`.                        | EXTEND | `lib/challenge.server.ts`, `lib/challenge.functions.ts` |
| 3.2 | `See all {n} →` in the rail, opening a portalled full-height sheet. **Lift `RosterSheet` out of `CaseFile.tsx` into a shared component** rather than writing a second one — that is the existing "see all" paradigm and it should have one implementation | MOVE   | `components/CaseFile.tsx` → `components/Sheet.tsx`      |
| 3.3 | Group `Today / This week / Earlier` from `atMs`; labels come from `historyRows`, unchanged                                                                                                                                                                | REUSE  | —                                                       |
| 3.4 | Wrap any new rail block in `Collapsible` so the tape below does not teleport; `rail-stability.test.ts` is the guard                                                                                                                                       | REUSE  | `components/Collapsible.tsx`                            |

### Phase 4 — gated on your rulings (I.1–I.4). Not started without them.

- §7 market-wide impact — needs a snapshot-cadence decision and reverses a documented rule
- §14/§15 same-side memory & surprise — needs `responded_side` persistence (I.2) _and_ the corpus
- §5 `ALEX PASSED` naming a passer — reverses a documented privacy decision

### The only CREATE in the whole plan

**`market_calls.responded_side text NULL`**, and only if you choose I.2 option 2.

Why nothing existing can carry it: `wallet_beliefs.stance_side` is the _current_ stance and
mutates on every flip — reading it as history is the exact drift `relation_at_call` was created
to prevent. `events` holds the frozen truth but reaching it means an unbounded per-pair scan,
against the module's own rule that no read here may become a graph traversal. There is no third
place. It is one nullable column on an existing row, written once by `markCallsAnswered` from a
value it already fetches — but it puts a side into a ledger that three files state must never
have one, and it earns nothing until months of history accumulate.

**My recommendation: do not create it in the first pass.** Phases 0–3 deliver _someone showed up_,
_where each person stood_ (present tense, on live cards where it is honest), _disagreement is
still showing up_, _reciprocity is visible_, and _complete history_ — with zero schema change and
one atomicity bug fixed. §14/§15 can be added later on top of a column that starts collecting
from the day it ships.

---

## L. Against the §21 first-principles test

| Question                                       | Phases 0–3                                                                                                                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Tells me someone showed up?                 | Yes — the card transforms in place instead of vanishing (2.3)                                                                                                             |
| 2. Tells me where each person stood?           | Present tense yes (`callerSide` + the recipient's own stance). Historically **no** — and it says nothing rather than guessing                                             |
| 3. Does disagreement still feel valuable?      | Structurally — there is no side in the reciprocity math, so a Rival who always answers ranks highest, exactly as `dependability.ts:55-61` intends                         |
| 4. Consequence without invented causality?     | Yes — audience-scoped `4 of 8`, frozen denominator, caused by the asking                                                                                                  |
| 5. Reciprocity visible?                        | Yes — `n back & forth`, derived, no new persistence                                                                                                                       |
| 6. Repeated interaction accumulates?           | Yes — the run grows; the history sheet keeps everything                                                                                                                   |
| 7. Makes me want to respond?                   | The card now shows what responding _did_, which it never has                                                                                                              |
| 8. Makes me want to challenge again?           | 0.2 fixes the bug that silently eats a re-issued slot                                                                                                                     |
| 9. Human information or workflow metadata?     | Human. The one remaining workflow word (`"viewed"`) is deleted in 0.4                                                                                                     |
| 10. Could we remove it without losing meaning? | The pieces I could remove, I did: no dashboards, no rates on the rail, no best-run, no market-wide counters, no new colours, no new navigation paradigm, no second scorer |

---

## M. What I need from you

1. **`SUPABASE_SERVICE_ROLE_KEY`** (or run `check:challenge` and `check:challenge-integrity`
   yourself and paste the output). Sections D, E, F and the §15 threshold stay blank until then,
   and the first thing it answers is whether `market_calls` has any rows at all.
2. **I.1** — audience-scoped impact only (my recommendation), or market-wide too?
3. **I.2** — ship without same-side memory (my recommendation), or add `responded_side` now?
4. **I.3** — "back & forth" with the word "streak" still banned (my recommendation), or lift the ban?
5. **I.4** — keep passes aggregate/unnamed (my recommendation), or name them?

Approve Phase 0–3 and answer 2–5, and I will start with Phase 0.

---

## N. What shipped

Phases 0–3 are built, under the audit's own recommended answers to I.1–I.5:
audience-scoped impact only, no `responded_side` column, "back & forth" with the
word _streak_ still banned, passes stay unnamed, and the Insider tape's existing
`showed_up` row left alone.

**Nothing in §C's `NEW` column was built. There is no schema migration in this
change, and no new table, resource, feed, scorer or ranking anywhere in it.**

### N.1 Two corrections to the audit

Both were found by reading the code the audit was proposing to change, and both
reverse a recommendation made a section earlier. They are recorded rather than
quietly dropped.

**The audit was wrong about `CHALLENGE.windowDays` (was step 0.3).** It said to
apply the 30-day window to `buildChallenges`, because the constant's own comment
claims the rail derives against it. Applying it would have **deleted deliberate
requests at thirty days** — the exact loss `composeChallenges` refuses when it
declines to truncate, and the number is inherited from a version of Challenge that
inferred calls from recent trades and no longer exists. The window's surviving job
is in `dependability`, where it decides when an unanswered call stops counting
against somebody. So the **comment** was corrected to say what is true, and the
code was left alone. The rail and the relationship disagree on purpose now, and
both are honest: the rail says Sarah is still waiting, because she is, and the
relationship declines to hold it against you.

**The audit was wrong about deleting `RecipientState = "viewed"` (was step 0.4).**
It called the state dead vocabulary. It is unreachable from the database, but it is
deliberately modelled in `domain/scene` — a lab participant sits in it, and
`checkWorld` asserts that viewing is never counted as showing up. Deleting it would
have removed a guard, not a workflow word, and it never reaches a screen. Left in
place.

### N.2 Phase 0 — the repair

| Change                                                                                              | Class  | Where                 |
| --------------------------------------------------------------------------------------------------- | ------ | --------------------- |
| Audience insert became `upsert(…, { ignoreDuplicates: true })`                                      | EXTEND | `lib/table.server.ts` |
| Unanswered calls from an earlier run are carried onto the new Challenge; terminated ones never move | EXTEND | `lib/table.server.ts` |
| `reached` reports what was actually written, not `audience.length`                                  | EXTEND | `lib/table.server.ts` |
| `CHALLENGE.windowDays` comment corrected (see N.1)                                                  | —      | `domain/challenge.ts` |

**B.2.1 is fixed.** A multi-row `INSERT` is atomic, so one duplicate rolled back the
whole audience — and because `market_calls`'s primary key has no `closed_at`
predicate, re-issuing a market that had been on the table before collided on every
row. The Challenge went up having reached nobody, printed no sentence (`reached: 0`
makes `progressLine` null), and could never auto-close (`allResponded` is false at
zero by design), holding one of three editorial slots forever. It now writes the
genuinely new recipients and re-points the people who never answered last time,
which is the audience a re-issue actually has.

### N.3 Phase 1 — reciprocity, from data that already existed

No new persistence. `passed_at` joined `CALL_COLUMNS`; everything else is derivation
over rows the two existing indexes already serve.

- `domain/dependability`: `PairCall`, `Reciprocity`, `reciprocity()`, `passedNow()`,
  `backAndForthLine()`, `runEndedLine()`, and `"streak"` added to `BANNED_UI_WORDS`.
- `dependabilityFor` now returns the run alongside the tallies **from the same two
  queries**, so the rail, the People cards and the profile cannot disagree about
  whether a pair goes back and forth.
- `buildChallenges` calls it once for the whole railful — two queries, not one per
  card — and the run travels on the `Challenge` row.

Every §9 constraint holds structurally rather than by convention: `PairCall` has no
side field, an unissued or unanswered call contributes nothing, `markCallsAnswered`
proves the position server-side before stamping, and `called_at` is used for
ordering only — never for calendar bucketing. `bothWays` is asserted equal to
`rungFor(...) === "each_other"` across a table of cases, so the two definitions of
"reciprocal" cannot drift into two answers.

### N.4 Phase 2 — the card transforms instead of vanishing

`buildChallenges` now also returns calls that reached a terminal state within
`FINISHED_WINDOW_MS` — the **same week the creator's finished Challenge already
stays on their own table**, so the two ends of one interaction go quiet together.

- `Challenge` gains `state`, `stateAtMs`, `reciprocity`; `composeChallenges` puts
  waiting rows above outcomes and orders outcomes by when they happened.
- One `<ul>`, keyed by market, so React reuses the element: the row a reader was
  looking at when they took a side stays where it is and changes what it says.
- The prompt and the `×` go; `outcomeLine` takes their place; the card goes dashed
  and transparent — the same "this ended" vocabulary the outbound side already uses.
- A local pass is **restated** rather than filtered out, so a card cannot vanish on
  the tap and reappear as an outcome on the next refetch. `passedNow` is asserted to
  produce exactly what appending the pass and recomputing produces.
- `open` counts only waiting rows, so the tab number and the mobile badge keep
  meaning _people are waiting on you_.

Whose rail it is decides the subject: on the reader's own rail an answered call
reads **"You showed up for Maya."**, because the reader is the one who turned up.
"Maya showed up" is the same row seen from her side and is already said there.

### N.5 Phase 3 — the complete history

- `challengeHistory(viewer)` — both directions, **no seven-day window**,
  chronological, reusing `titlesFor`, `resolveProfiles` and the `historyRows`
  vocabulary the profile's "Between you" section already renders.
- `CallDirection` gained `you_passed` and `waiting_on_you`. It deliberately did
  **not** gain `they_passed`: a row a viewer's history cannot show without naming a
  passer is skipped, not softened. That is decision I.4 enforced in the type.
- `RosterSheet`'s implementation **moved** out of `CaseFile` into
  `components/Sheet` and both surfaces render it — the existing "see all" paradigm
  with one implementation instead of two that would drift.
- `groupHistory` buckets into Today / This week / Earlier, and never renders an
  empty pile.
- The read is bounded like every read in this file, and the payload says
  `truncated` out loud rather than presenting a bounded list as the whole story.

### N.6 Verification

- `2610 passing`, up from `2566`. The 6 failing tests and 4 module-load failures are
  **pre-existing and in unrelated files** (`create-flow`, `explore-lens`,
  `rail-stability`, `why-this`, `feed-question-order`, and four suites that cannot
  load `viem`/`wagmi`/`vitest` types in this environment). Identical before and after.
- 44 new assertions, all of them §23 invariants: no Accept, taking a side is the
  response, a pass never masquerades as showing up, agreement is never required, a
  run cannot be manufactured by issuing or by ambient trading, the history runs
  through no scorer, and no surface says _streak_.
- Typecheck is clean across every touched file.
- Three existing tests were updated rather than deleted, each with the reasoning for
  the change written next to it: the audience write is an upsert now, the quiet-room
  guard has two conditions, and the lab's card count is everyone the question
  reached rather than everyone still waiting.

### N.7 Still open

Unchanged from §M — these need the service key or a ruling, and none of them are
blocked by the code above:

1. **`SUPABASE_SERVICE_ROLE_KEY`.** Sections D, E, F and the §15 threshold stay
   blank without it, and the first thing it answers is whether `market_calls` has
   rows at all. If it is empty, everything above has no fuel and the work is upstream.
   **They are now one command away rather than a research task — see N.8.**
2. **§7 market-wide impact** — the audience-scoped version shipped; the market-wide
   version needs a snapshot-cadence decision and reverses a documented rule.
3. **§14 / §15 same-side memory and surprise** — needs `responded_side` (I.2) _and_
   the corpus distribution. Not built, and not buildable honestly today.

### N.8 The blocked sections, answered by one command

`scripts/check-challenge-integrity.ts` gained three sections that answer exactly
what §0 could not read. It still refuses to run without the service key, for the
reason it already gave: `market_calls` returns **200 with an empty array** to the
publishable key, and a report that accepted that would print a clean bill of health
for a ledger it never saw.

```
npm run check:challenge-integrity          # add --json to track over time
```

| New section          | Answers                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **8 · The corpus**   | Audit **D** and the **§15** threshold. Calls, answered / passed / waiting, how many waiting rows have aged past 30 days, pre-V2 rows with no `challenge_id`, challenges put up and how they ended, and the person-pair interaction distribution bucketed 1 / 2 / 3–4 / 5–9 / 10+.                                                                                                 |
| **9 · Back & forth** | Audit **E**. How many pairs go both ways, how many would actually show a line, the longest run, and up to five **real sequences** rendered as `·→←→←`. It **imports the shipped `reciprocity()`** rather than reimplementing it — a copy would make the report confirm itself instead of the code that renders the card.                                                          |
| **10 · Slot damage** | Audit **F**, plus the fallout of the atomic-insert bug. Challenges that reached nobody and are still holding a slot, named with their market and date; cap breaches; the same market up twice. It **reports and does not repair** — the fix prevents new damage and heals none of the old, and closing somebody's Challenge for them is not a decision a diagnostic gets to make. |

Two things also changed in what the report already claimed. `passed_at` and
`challenge_id` are now read — they were in the table and unselected, so the footer
went on describing dismissal as invisible long after it became durable. And the
"not measurable" footer gained the honest version: what nobody can recover is the
side each person held **at the time**, which is the single fact blocking §14/§15.

**Verified end-to-end.** The three sections were run against a stub PostgREST
seeded with a four-answer alternating pair, a one-way pair, a run ended by a pass,
a call aged past the window, and one Challenge deliberately left reaching nobody.
Every section produced the right answer, including finding the seeded slot damage
and correctly refusing to call the one-way pair a back & forth. Both text and
`--json` output are clean.

---

## O. §4 — Who a Challenge may reach

### O.1 Two concepts that were one

`relation_at_call` is what the DNA engine believed at the moment somebody was
asked. It is frozen forever and it is relationship **truth**. "Still Forming" is
a **heading on a screen**. Storing the heading would make presentation copy
permanent, and the day the grouping was renamed every historical row would be
lying about what the engine actually knew.

So `src/domain/audience.ts` names them separately and `"forming"` is never
written:

| Type                 | Values                                                  | Where it lives |
| -------------------- | ------------------------------------------------------- | -------------- |
| `CallRelationAtTime` | `twin` `tribe` `neutral` `opp` `inverse` `insufficient` | the database   |
| `AudienceGroup`      | `tribe` `rivals` `forming`                              | a render       |

`audienceGroupFor()` derives the second from the first, exhaustively, every time.

### O.2 Still Forming means evidence, never a shortfall of recipients

Exactly three provenances qualify, each a fact the canonical graph can already
explain:

| Provenance           | The fact behind it                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `neutral_dna`        | the engine cleared the evidence bar for this pair and found no strong alignment. It **looked**, and it has an answer.                    |
| `closest_match`      | at least one shared directional belief. Zero shared beliefs is not a thin relationship, it is no relationship.                           |
| `answered_challenge` | one asked and the other answered. The case DNA is structurally incapable of seeing — a Market Maker holds no directional beliefs at all. |

**Follows are not one of them.** `setFollow` accepts the claimed follower wallet
without proving control of it. That is survivable for a lightweight public
preference and is not survivable when a row places a social obligation on
somebody else's screen: a forged follow would manufacture an audience seat.

Cold start is answered with an honest empty state, not a lowered bar.

### O.3 The read side had to learn the same six words

The write path began freezing `neutral` and `insufficient`. `buildChallenges`
validated a stored `relation_at_call` against a **four**-value list and skipped
anything that did not parse — so every Still Forming call would have been written
correctly and then rendered to nobody. `CALL_RELATIONS` is now one exported list,
imported by both sides, and `callRelationAtTime()` is the only parser.

The same widening reached `CallerRelation`, `RELATION_RANK`, the three `BADGE`
maps and `ChallengedView.badge`, which gained the third word: **Still Forming**,
the same two words the audience heading uses.

### O.4 The preview and the write still agree

`CallReach` gained `forming`. Without it, the reach line and `relayButtonLabel`
would have counted two groups out of three — the 32-person gap of §4 arriving
from the other direction, and an offer to relay hidden entirely from somebody
whose whole audience is Still Forming. `reachTotal()` is the one place the groups
are added up, and it returns `null` for a refused read, because a refusal is not
a total of zero.

### O.5 Profiles come last, and cannot filter

`AudienceCandidate` (membership) and `AudienceMember` (membership + a face) are
different types, so the wrong order is unwriteable: there is nothing to resolve
profiles into until membership already exists. `resolveProfiles` falls back to the
deterministic alias, so a missing `profiles` row is a missing picture and never a
revoked invitation.

### O.6 Rendered, and one flaw found only by looking

`AudiencePreview` fetches; `AudienceGroups` renders. The split exists so
`/lab-9f3c7a21b4` can show a full audience — a Twin beside two Tribe members, a
Rivals row that overflows the face cap, and three Still Forming people arriving
through all three provenances — with no DNA cache, wallet or network.

Rendered, the three labels started at three different x positions, because each
face stack was a different width and the rows stopped reading as one list. Fixed
with a `min-w-[102px]` gutter sized to a full stack. Nothing in the types or the
tests could have caught it.

### O.7 The migration that is not 42703-tolerant

`20260907000000_call_relation_forming.sql` widens the `market_calls_relation`
CHECK to the six values. **It is a harder blocker than the chain columns.** Those
were tolerated — the code caught 42703 and retried without them. A CHECK is not:
Postgres _rejects_ a row carrying `neutral` or `insufficient`, and because the
audience is written as one upsert, a single rejected row rolls the whole statement
back and **the Challenge reaches nobody while still holding a slot**.

Section 12 of `check:challenge-integrity` reports on it and deliberately refuses
to conclude from row counts alone — zero Still Forming rows is what an unapplied
migration looks like _and_ what an applied one looks like before anybody has a
neutral person in range. It prints the `pg_constraint` query that settles it.

---

## P. The ghost Challenge, and making the write atomic

### P.1 What the four writes could leave behind

`putOnTable` did this in four round trips: take a slot, insert the `challenges`
row, repoint last run's unanswered calls at it, write the recipients. Only the
first two could fail loudly. **A failed recipient write was logged and swallowed,
and the function returned `ok: true` with `reached: 0`.**

That is a Challenge which exists, occupies one of three editorial slots, asks
nobody, prints no progress sentence, and can never auto-close — `allResponded` is
false at zero, so `shouldAutoClose` never fires. It holds that slot **forever**.

The unapplied `market_calls_relation` CHECK is what made it visible: a Challenge
reaching a Still Forming person is rejected by Postgres and produces exactly that
corpse. But the CHECK is only the current trigger. Any recipient-write failure —
a foreign key, a dropped connection, a statement timeout on a large audience —
produces the same thing.

### P.2 Why a compensating close would not have fixed it

The obvious repair is "if the recipients did not land, close the Challenge". It
is wrong here, and not marginally.

By the time step four fails, **step three has already repointed last run's
unanswered calls at the new Challenge.** Closing it strands those people: the
question they are still being asked quietly stops being asked, and their original
Challenge cannot be restored, because the pointer that said which one it was has
been overwritten. A compensating action cannot recover information the failed
sequence destroyed. The write has to be undone, not apologised for.

### P.3 One function is one transaction

`put_on_table(challenger, market_id, parent_call, audience jsonb)` holds the slot
allocation, the Challenge insert, the carry, the recipient upsert and the reach
count. Every write lives inside a `BEGIN … EXCEPTION` block — a plpgsql
subtransaction, so reaching the handler undoes every row the block touched.

```
ok = true   →  a durable, active Challenge exists AND reached > 0
ok = false  →  no Challenge exists, no slot was consumed, nothing was carried
```

Unchanged by the move: the cap is still **collided with, never counted** — the
slot walk letting `challenges_active_slot_idx` reject a taken slot moved into the
function intact. The recipients are still an upsert with `DO NOTHING`, because
`market_calls`'s primary key is unique _forever_ rather than per Challenge.
`relation_at_call` is still absent from the carry's `SET`.

New: **`parent_call` is validated rather than trusted.** The foreign key only
proves the call exists. A relay must additionally be in this market, addressed to
the person now putting the question up, and actually answered — otherwise
"Maya → Sundeep → You" is drawn from a number.

**There is no fallback to the old path.** If the function is not deployed the
write refuses with `PGRST202` logged. Falling back would restore the exact defect
this replaces, and a Challenge that never went up is recoverable in a way a ghost
holding a slot is not.

### P.4 Proved against a real cluster, because the claim is transactional

"No slot was consumed" is a statement about what survives a rollback, and a mock
cannot be wrong about a rollback it is simulating. `put-on-table.pg.test.ts` runs
the real function on a real Postgres and inspects the tables afterwards.

```
npm run test:pg        # brings up a throwaway cluster, runs it, tears it down
```

22 tests: neutral and insufficient recipients, mixed strong + forming audiences,
recipient constraint failure, zero actual reach, no slot consumed on any failure,
no carried call changed after rollback, three invalid `parent_call` shapes,
duplicate live market, full table, slot reuse after close, and returned reach
matching durable recipient rows.

The constraint failure is reproduced **deliberately**, by narrowing the CHECK back
to four values mid-test — that is the failure the production database can produce
today, and simulating it any other way would be testing something else.

Two guards on the harness itself. The suite **skips without a cluster and says so
out loud**, because a silently skipped suite reads as a passing one in a summary
line. And `scripts/put-on-table-schema.sql` is asserted against the real
migrations, so a constraint relaxed in the fixture and not in production cannot
quietly make every test above weaker than the thing it claims to prove.

### P.5 Two new refusals reach the surface

`bad_parent` and `no_reach` join the `PutResult` union. `no_reach` shares
`no_audience`'s sentence, because to the reader they are one fact — the write
landed on nobody — differing only in where it was discovered. The copy dropped
"as your Tribe and Rivals form": there are three groups now, and naming two of
them tells somebody whose whole network is Still Forming that they do not have
one.
