# Feature: Emoji ops — shortcode atomic glyph widget (note-taking simulation)

A loaded-ops session on the plugins route over the first-party emoji plugin. The bare
`:shortcode:` rung renders an atomic glyph widget whose literal source bytes stay in the
block's raw, so it is the decoded-entity twin: a widget that contributes its glyph, not
its raw, to textContent. The session drives real edits adjacent to the widget while the
oracle stack — structured error + `[invariant:…]` console watcher, live-CST round-trip,
nested BlockListState audit, and live-vs-reparse convergence — re-checks after every
move, with a fixed seed for determinism.

The emoji plugin is seed-gated (the bare `:` rung installs under `?seed=emoji`), so the
session navigates there and loadContents its own document. The shortcode is typed
MID-prose so the atomic step-over and single-press delete run against real neighbours;
because emoji bytes round-trip byte-for-byte, convergence runs unconditionally.

## Happy paths

- typing `:shortcode:` mid-prose mounts an atomic glyph widget once the closing `:`
  lands; the literal bytes stay in the block's raw, so the source carries the shortcode
  verbatim (e.g. `Alpha:tada: lead …`) and only the widget count marks the mount
- a plain ArrowRight from the widget's leading edge steps the caret over the whole
  atomic island in one press (landing on the trailing edge), and a plain ArrowLeft steps
  back over it in one press — the `onEdge: 'step-over'` policy in both directions
- a single Backspace from the widget's trailing edge removes the whole shortcode in one
  press and one undo entry (`deleteGranularity: 'atomic'`), netting the document back to
  its loaded bytes

## Edge cases

- the mid-prose insert is not an end-of-document append, so the expectation tracker
  cannot predict it and each gesture settles on the widget swap and resyncs from observed
  state
- a caret press that landed INSIDE the island (an offset strictly between the source
  start and end) fails the step-over gesture loudly, so a regression that broke the
  atomic edge would not record a corrupted caret as truth
- undo restores the atomically-deleted shortcode whole in one entry, then a second undo
  removes the mid-prose insert and returns to the loaded bytes

## User interactions

- the shortcode is typed with real per-character keyboard input at a mid-block caret
  placed by the selection API
- the step-over walks the caret to the widget's leading edge with real ArrowRight
  presses, then presses ArrowRight and ArrowLeft once each across the island
- the atomic delete walks to the trailing edge with real arrows, then presses Backspace
- undo uses the real cross-platform shortcut around a forced batch boundary

## Error cases

- no console, page, or structured editor error fires across the session, including the
  `[invariant:…]` channel
- the live serializer round-trips the current CST at every oracle checkpoint, and a
  reparse of that serialization converges back to the live tree at every checkpoint (the
  emoji bytes never split the tree, so convergence is never waived)
- the nested-state audit finds no BlockListState desync after any insert, step-over,
  delete, or undo
