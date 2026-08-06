# Remove "Now reading", move "In this market" to the left rail

The playlist's pinned "Now reading" card and the right rail's "In this market" card both restate the market the centre panel is already showing. One anchor is enough, and it belongs where the reader picks what's next.

## Changes

1. **Drop the "Now reading" card** from the For You playlist. The playlist becomes filter bar + running order only. The active market stays excluded from the list (it's the one on screen), and the "You're at the end of this feed" message keeps working.

2. **Move "In this market" to the top of the For You tab**, above the filter menu. Same card, same behaviour: collapses when the market is quiet, shows the latest beat, expands downward in place.

3. **Remove "In this market" from the right rail.** The right rail becomes Welcome prompt → duplicate suggestions → the global "Now" tape, which keeps excluding the current market so nothing is shown twice.

4. Mobile keeps its existing placement (it renders the same card in the mobile game view) — no change there.

## Note on what's lost

"Now reading" also carried the *why this market was surfaced* line and its metrics. With the card gone, that reason only appears on the market's own row in the running order and in the centre panel. If you want the reason kept in the rail, say so and I'll pin a one-line reason strip in its place instead.

## Technical

- `src/components/FeedListPanel.tsx` — delete the "Now reading" block; the `activeTitle` prop and the now-unused `activeFacts`/`active` lookups go with it.
- `src/routes/index.tsx` — stop passing `activeTitle`; move the `<CurrentMarketActivity>` mount out of the right rail and into the left rail's `feedList` node, wrapped above `<FeedListPanel>` so it only shows on the For You tab.
- Keep `excludeMarketId={shownId}` on the right-rail `LiveTape`.
- Update the affected notes/tests that reference the "Now reading" card (`src/components/why-this.test.ts`, `src/domain/feed-queue.test.ts` comments, `src/components/rail-stability.test.ts` if it asserts rail order).
