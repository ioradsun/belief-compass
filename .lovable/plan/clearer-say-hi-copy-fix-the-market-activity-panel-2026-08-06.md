# Clearer "Say Hi" copy + fix the market activity panel

Two small, presentation-level fixes to the center rail.

## 1. Say Hi card — say why these people are here, in fewer words

Today the headline is assembled from relationship groups and reads like a report:

```text
Since you were last here: 1 first-timer
In the room: 2 Opps crossed to your side · 1 Twin
3 people still waiting on a hello
```

Problems: "first-timer", "Opp", "in the room" don't tell you *why* these faces
appeared, and the "since you were last here" prefix eats the line.

New copy — always leads with the one reason everyone in this card is here
(they took the same side as you), then names who they are only when it's
interesting:

| Situation | New headline |
| --- | --- |
| Only new faces | `1 new believer joined your side` / `4 new believers joined your side` |
| Twins present | `Your Twin joined your side` / `2 Twins joined your side` |
| A rival crossed | `An Opp crossed to your side` / `2 Opps crossed to your side` |
| Mixed groups | Lead with the rarest group, then `+2 more joined your side` |
| Nobody new, some still unwelcomed | `3 waiting on a hello` |

Rules: one line, no "Since you were last here:" prefix, max two clauses, and the
verb is always "joined your side" / "crossed to your side" so the reason is in
the sentence itself.

## 2. Market activity panel

- Rename the label from **Live activity** to **IN THIS MARKET** (both the
  collapsed header and the expanded sheet header).
- The lead line currently uses `truncate`, so the latest beat is cut off
  mid-word. Switch to wrapping (clamped to 2 lines) so nothing is lost.
- Remove the trailing count entirely. `5 updates` is the raw row count from the
  query, while the expanded sheet groups/collapses those rows into fewer
  entries — the two numbers can never be made to agree without changing the
  grouping. The `+N new` unread badge is computed from the same raw count, so
  it goes too. A simple chevron remains as the affordance to open.

## Technical notes

- `src/domain/welcome.ts` — rewrite `roomHeadline`; update
  `src/domain/welcome.test.ts` if it asserts headline strings.
- `src/components/CurrentMarketActivity.tsx` — label text, `truncate` →
  `line-clamp-2`, delete the `seenCount` / `unread` state and the count line.
- No backend, query, or data changes.
