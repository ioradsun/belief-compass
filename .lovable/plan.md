# Mobile: See both sides opens inside the market, not as a new screen

## What happens today

On a phone, tapping "See both sides" swaps the *entire* screen. The question,
the creator byline and the order bar all unmount and are replaced by a separate
page with a "← Back" link at the top and a repeated copy of the question below
it. Reading a side means leaving the market; acting on what you read means
going back first.

That is the wrong model for what this actually is. Both-sides is not another
destination — it is a different *view of the same market*. The question and the
decision are constants; only the evidence between them changes.

## The shape to build

Keep the frame, swap the middle.

```text
┌───────────────────────────────┐
│ Question (2 reserved lines)   │  stays, never moves
│ creator · age                 │  stays
├───────────────────────────────┤
│                               │
│   MIDDLE — swaps:             │
│   market view  ⇄  both sides  │
│                               │
├───────────────────────────────┤
│ [ Back YES ] [ Back NO ] Pass │  stays, always reachable
└───────────────────────────────┘
```

- The question block and the order dock stay mounted across the switch. Nothing
  in them re-renders, re-measures or shifts.
- "See both sides" no longer navigates. It flips the middle region.
- The way out is a close control **on the both-sides content itself**, top-right
  of the middle region, aligned with its first row — not a back link floating
  above the question.
- The duplicated question inside the both-sides page is deleted; there is only
  ever one question on screen, the one at the top.
- Android/iOS back and swipe-back still close the view rather than leaving the
  market, so the gesture and the button agree.

## Reworking both-sides for the smaller space

The middle region is shorter than a full screen, so the current layout — big
YES block, big NO block, each with a face pile and an expandable details
section stacked vertically — will not read. Rework it as:

1. **One comparison line at the top**: which side is gaining, in a sentence.
2. **A single split bar** showing the believer split, so the balance is read
   before any number.
3. **Two side rows, one above the other, always both visible**: side label,
   believers, committed, and today's move. This is the whole promise of "see
   *both* sides" — they must be legible together without scrolling.
4. **Tap a side row to expand it in place** into who backs it (face pile →
   roster), why people believe, and recent activity. Expanding one collapses
   the other, so the region never grows unbounded.
5. Scrolling stays inside the middle region only. The question and dock never
   scroll away.

The order bar keeps working while a side is expanded — reading the case for NO
and then backing NO is two taps in the same screen, with no navigation between
them.

## Technical notes

- `src/components/MobileGame.tsx`: `phase === "sides"` currently early-returns a
  standalone `<Screen>` containing `BothSides`. Remove that early return; keep
  the normal render and pass a `sides` flag that swaps `marketBody` for
  `<BothSides>` inside the existing middle container. `questionBlock` and
  `<Dock>` stay in the tree unchanged.
- `BothSides` loses its own `<Screen>`, `← Back` button and `<h2>{title}</h2>`;
  it gains a close control in its own header row and is restructured per the
  layout above. Its data (`evidenceQO`, `listMarketPulses`, `useMarketChange`)
  is unchanged, so no query keys or server functions move.
- `ExamineCta` in the dock keeps `onToggle`, but now toggles between
  `question` and `sides` rather than pushing a phase, and its label reflects
  the open state.
- The comparison sentence and split reuse the existing pure
  `src/domain/side-compare` helpers already used by `MobileCase.tsx`, so the
  mobile copy matches the desktop Case File instead of being a third phrasing.
- Desktop (`MarketDeck` / `CaseFile`) is untouched.
