<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

<!-- FORGE:BEGIN -->
## Conviction Forge

Forge is the admin-only engineering control center at `/admin/forge`. Its
engineering rules — the Conviction Prime Directive, model roles, execution
modes, verification profiles, job lifecycle and git policy — live in
[docs/FORGE.md](docs/FORGE.md). Read that before changing anything under
`src/lib/forge/`, `src/lib/forge.functions.ts`, `src/components/forge/` or
`src/routes/admin_.forge.tsx`.
<!-- FORGE:END -->

<!-- APP-MAP:BEGIN -->
## The app, in one read

Conviction is a **belief-market** product. The loop is `challenge → match →
resolve → reputation → repeat`: someone posts a belief, others take a side (a
market forms), it resolves, and reputation / DNA accrues. Positions are real,
settled through an on-chain wallet.

### Stack
- **TanStack Start** (React + file-based routing) on **Vite**, TypeScript everywhere.
- **Supabase / Postgres** for data; **RLS is on**; the service-role client is server-only.
- **wagmi / viem** for wallet + chain (`src/chain`).
- Server logic is **TanStack server functions** (`*.functions.ts`) and server-only
  modules (`*.server.ts`). Tests are `*.test.ts` next to the code; the `check:*`
  scripts are the deterministic integrity suite.

### Layers — respect them, top is purest
1. **`src/domain/**` — pure logic.** No network, no React, no Supabase. The brain:
   ranking, calibration, DNA, market math, the product's copy/voice. Every concept
   is `<name>.ts` + `<name>.test.ts`. **Most behavior lives here and is unit-tested —
   start here.**
2. **`src/lib/**` — server + shared.** `*.functions.ts` are the API the UI calls
   (admin ones call `requireAdmin()`); `*.server.ts` are server-only (DB, external
   calls) and must never be imported into a client component. Also `supabase-clients.ts`
   (`serviceClient()`), and `dna/`, `insider/`, `email-templates/`, `forge/`.
3. **`src/components/**` — React UI.** Presentation + wiring; logic belongs in domain.
4. **`src/routes/**` — routes.** `index.tsx` is the app, `m.$mid.tsx` a market,
   `admin_.forge.tsx` the Forge room, `api/` server routes, `og/` OG images.
5. **`src/integrations/supabase/types.ts`** — the **generated** DB types. Add a
   table/column → update this file or `.from("…")` won't typecheck.
6. **`src/hooks/`, `src/chain/`** — React hooks and wallet/chain.

### Where each subsystem lives
- **Feed & discovery** — `src/domain/feed*`, `src/domain/feed/`, `src/domain/insider/`,
  `src/lib/feed*`, `src/lib/insider/`. Ranking, supply, archetypes, cadence, the Insider corpus.
- **Identity / calibration / DNA** — `src/domain/dna*`, `src/domain/calibration*`,
  `src/lib/dna/`, `src/lib/calibration.server.ts`.
- **Markets / positions / orders** — `src/domain/market*`, `position*`, `order*`,
  `src/lib/market-*`, `challenge*`.
- **Reputation / conviction** — `src/domain/conviction-*`, `standing-*`, `relationship*`, `person-*`.
- **Story / copy / voice** — `src/domain/story*`, `copy*`, `voice*`, `grammar.ts`. The
  product speaks in a specific voice; **reuse these helpers, don't invent copy.**
- **Wallet / chain** — `src/chain/`, `src/lib/chain-trade.ts`.

### Data
- Migrations in `supabase/migrations/*.sql`, applied in order. Pattern:
  `CREATE TABLE` → `GRANT … TO service_role` → `ENABLE ROW LEVEL SECURITY` →
  a `touch_updated_at` trigger.
- Server code uses `serviceClient()` (service role, bypasses RLS) — so **gate every
  server function with `requireAdmin()`** where the data isn't public.

### How to make a change (house style)
1. Find the mechanism that **already** owns the behavior and extend that one source
   of truth — do not create a second. Most changes begin in `src/domain`.
2. Keep domain logic pure and covered — add/update the `<name>.test.ts` beside it.
3. Wire it through a `*.functions.ts` server fn if the UI needs it; render in a component.
4. Match existing conventions and the product voice. Don't weaken or delete tests to
   pass, and don't touch unrelated code.
5. Before finishing: `check:types`, `lint`, `build`. The `check:*` integrity scripts
   (feed / identity / money) run in CI against a live DB.

### Guardrails
Never deploy to prod (a human merges the PR). No token economics / pricing / gambling
mechanics, no auth/authz changes, no irreversible DB changes, no architectural
rewrites — if one seems required, stop and recommend instead. Performance and refactor
changes need a **measured** problem and a before/after number, never speculation.
<!-- APP-MAP:END -->
