# Feature: the decoration edit epoch follows the keystroke, not the typing batch

A decoration source runs on every document change. The edit channel's `input` event is
deliberately batched (one undo entry per typing burst), so an epoch driven by that event
only advances when the burst ends, and until then every source keeps serving the previous
document's decorations. The overlays measure those stale offsets, so marks visibly drag
behind the text the user just moved.

Scenarios run on `/test/plugins?seed=hloccur-memo`, whose seed publishes the plugin's
index-rebuild count to `window.__hloccurScans`. Block [0] is the paragraph
`alpha beta alpha`, so a caret on the first `alpha` paints two overlays in it.

Playwright's fake clock is installed and paused after the caret is placed, so no in-page
timer fires for the rest of the scenario while the runner's own retries keep their real
clock. That is what makes the pin deterministic rather than a race against the typing
pause: the refresh under test is microtask-grained (an effect plus a `tick()`), while
anything waiting on the batch needs wall-clock time the frozen page never gets.

Miss-analysis: every decoration spec awaited its assertion through Playwright's default
expect timeout, which is longer than the typing pause, so a refresh that arrived one
typing pause late always passed.

## Happy paths

- typing a space in front of the anchored word, with the clock frozen, leaves each of the
  block's two occurrences covered by an overlay: every overlay's left and right edge sits
  within a pixel of the live Range rect of the word it marks, and no extra overlay is
  painted
- the same keystroke rebuilds the memoized index exactly once (`__hloccurScans` increases
  by one) while the clock is frozen, so the epoch reached the source without the typing
  batch flushing

## Edge cases

- the word's own rect moves in the same frozen-clock window: a stationary overlay
  therefore means a stale decoration, not a page that stopped rendering (the liveness half
  of the oracle, asserted before the coverage half)
- a stale mark re-measures into MORE overlays than there are words, because the typed
  character re-fragments the text nodes its offsets land in, so the count is asserted
  alongside the coverage
