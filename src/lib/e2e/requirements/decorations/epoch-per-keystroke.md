# Feature: the decoration edit epoch follows the keystroke, not the typing batch

A decoration source runs on every document change. The edit channel's `input` event is
deliberately batched (one undo entry per typing burst), so an epoch driven by that event
only advances when the burst ends, and until then every source keeps serving the previous
document's decorations. The overlays measure those stale offsets, so marks visibly drag
behind the text the user just moved.

The occurrence highlight reads that same batching from the other side. Its marks step aside
on the keystroke and come back on the `input` flush, so what these scenarios pin is a source
that keeps re-running per keystroke underneath a mark set that stays empty until the burst
ends.

Scenarios run on `/test/plugins?seed=hloccur-memo`, whose seed publishes the plugin's
index-rebuild count to `window.__hloccurScans`. Block [0] is the paragraph
`alpha beta alpha`, so a caret on the first `alpha` paints two overlays in it.

Playwright's fake clock is installed and paused after the caret is placed, so no in-page
timer fires until the scenario advances it, while the runner's own retries keep their real
clock. That is what makes both halves deterministic rather than a race against the typing
pause: the per-keystroke rebuild is microtask-grained (an effect plus a `tick()`), and the
marks coming back needs the wall-clock pause a frozen page only gets when the spec hands it
over.

Miss-analysis: every decoration spec awaited its assertion through Playwright's default
expect timeout, which is longer than the typing pause, so a refresh that arrived one typing
pause late always passed. The step-aside half went missing a second way: the occurrence
specs asserted marks after a click and never typed through one, so "highlighted while you
type" was never a scenario anyone wrote down.

## Happy paths

- typing a space in front of the anchored word, with the clock frozen, clears every overlay
  in the block: the marks step aside for the burst
- advancing the frozen clock past the typing pause flushes the batched `input` event and
  paints the overlays back onto the words they mark: every overlay's left and right edge
  sits within a pixel of the live Range rect of the word it marks, and no extra overlay is
  painted
- the same keystroke rebuilds the memoized index exactly once (`__hloccurScans` increases
  by one) while the clock is frozen, so the epoch reached the source without the typing
  batch flushing

## Edge cases

- the word's own rect moves in the same frozen-clock window: a word that had not moved would
  mean the page stopped rendering rather than the marks stepping aside (the liveness half of
  the oracle, asserted before the empty overlay set)
- a stale mark re-measures into MORE overlays than there are words, because the typed
  character re-fragments the text nodes its offsets land in, so the count is asserted
  alongside the coverage once the marks are back
