# `src/domain/insider` — the Insider contract

> **No product surface calculates market intelligence.** Facts are produced by the
> canonical data systems (`events`, `wallet_beliefs`, `market_state`). **The
> Insider** interprets those facts. Product surfaces only **filter, aggregate,
> personalize, and render** Insider output.

This module is the **single-resource contract** for that interpretation layer. It
is **types only** today (`types.ts`) plus the constitutional constant (`index.ts`).
The builder and projections migrate inward one at a time — see
[`docs/insider-architecture.md`](../../../docs/insider-architecture.md) for the
full surface inventory, current-state mapping, and migration plan.

## One system, four projections

| Projection | Question it answers | Contract type |
|---|---|---|
| **Activity** | What just happened? | `InsiderActivity`, `InsiderSignal[]` |
| **Insight** | What does it all mean? | `InsiderInsight` (over `InsiderPulse`) |
| **Now** | What deserves my attention? | `InsiderNow`, `InsiderStory[]` |
| **Read** | What do we think YOU will do? | `InsiderRead` |

## Two rules that make this work

1. **Calculate evidence once, interpret per surface.** `InsiderEvidence`
   (magnitude, velocity, participation, capitalFlow, imbalance, novelty, freshness)
   is computed once per signal. Each projection reads the *same* evidence and asks
   a *different* question. There is **no single `insiderScore`** — one number for
   everything eventually makes the product stupid.

2. **One resource = one contract, not one payload.** `InsiderMarket` is the
   per-market resource; `InsiderNow` is the global feed. They are separate cache
   scopes, so global facts stay cacheable and the viewer overlay (`read`,
   `personalRelevance`) layers on afterward.

## Boundaries

- **Evidence vs judgment are separate** (`InsiderEvidence` vs `InsiderJudgment`) so
  raw dimensions never collapse into a score prematurely.
- **Global vs viewer are separate** (`InsiderViewerOverlay` is optional on a
  signal; `read` is optional on a market) so global evidence stays side-blind and
  cacheable.
- **Provenance is mandatory** (`InsiderProvenance`: `sourceEventIds`,
  `reasonCodes`, `builderVersion`) so identical inputs replay to identical signals
  — the parity contract every migration step is proven against.
- `null` in evidence means **not computed**, never `0`. That distinction is what
  keeps sparse markets quiet.

## Usage

```ts
import { INSIDER_CONSTITUTION, type InsiderMarket, type InsiderSignal } from "@/domain/insider";
```

A YES/NO activity rail is a filter, not an engine:

```ts
insider.activity({ marketId, side: "YES" });
```
