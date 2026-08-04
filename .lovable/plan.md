# Mobile "See both sides" — believer face pile

Right now each mobile case page (NO / YES) ends with a full vertical list of everyone backing that side. On a 393px screen that list dominates the page and pushes the chart and momentum beats out of view.

Replace it with an Instagram-likers pattern: a compact row of faces plus a sentence, tappable to open the full list.

## What it looks like

```text
( )( )( )  Backed by John, Sam and 12 others
```

- Up to **3 overlapping avatars** (24px, 8px overlap, ring in the page background so they read as a stack).
- Sentence rules (dynamic, Instagram-style):
  - 1 person: "Backed by John"
  - 2: "Backed by John and Sam"
  - 3: "Backed by John, Sam and Amber"
  - 4+: "Backed by John, Sam and 12 others"
  - 0: "No one on this side yet." (unchanged)
- Names come from the same ranked roster already used (relationship-first: Twin/Tribe surfaces before strangers), so people you know appear in the faces.
- Tapping **an avatar** opens that person's profile (existing universal person-focus behaviour).
- Tapping **the sentence / row** opens a bottom sheet with the full roster — the exact rows that render today (avatar, name, shared-DNA line, amount), scrollable, dismissed by an X and by backdrop tap.

## Spacing review

- Face pile row: 24px avatars, single line, 8px gap to text, ~36px total height — replaces a list that was ~44px per person.
- Section keeps its existing "Who backs YES/NO · n" label so the count is still visible without opening anything.
- The sheet takes up to 75% of viewport height with its own scroll, so the carousel underneath never scrolls behind it.

## Scope

- Mobile only. The desktop case columns keep the inline roster (they have the vertical room).

## Technical notes

- New `BelieverFacePile` component in `src/components/CaseFile.tsx` (or a small sibling file), reusing `rankBelievers` and `PersonAvatar` so no new queries are added.
- `CaseRoster` gains a `variant="compact" | "list"` prop; `CaseColumn` passes `compact` when rendered inside `MobileCase`, via a new prop threaded from `MobileCaseView`.
- Full-list sheet uses the existing shadcn sheet/drawer primitive already in the project; avatar taps route through `focusPerson` from `src/lib/person-focus.ts`, which already closes into the center profile panel.
- Presentation only — no server functions, queries, or schema change.
