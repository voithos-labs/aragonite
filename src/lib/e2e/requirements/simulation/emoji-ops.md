# Feature: Emoji ops, shortcode atomic glyph widget (note-taking simulation)

A loaded-ops session on the plugins route over the first-party emoji plugin. The bare
`:shortcode:` inline handler renders a single glyph widget whose literal source bytes stay
in the block's raw, so it is the counterpart of the decoded-entity widget: a widget that
contributes its glyph, not its raw bytes, to `textContent`. The session drives real edits
next to the widget while the reference checks (the structured-error and `[invariant:…]`
console watcher, the live-CST round-trip, the nested `BlockListState` audit, and the
comparison of the live tree against a reparse of its serialization) run again after every
move, with a fixed seed so runs repeat.

The emoji plugin is seed-gated (the bare `:` handler installs under `?seed=emoji`), so the
session navigates there and loads its own document with `loadContents`. The shortcode is
typed in the middle of prose so the step-over and the single-press delete run against real
neighbours; because emoji bytes round-trip byte for byte, the reparse comparison runs at
every checkpoint.

## Happy paths

- typing `:shortcode:` mid-prose mounts a single glyph widget once the closing `:`
  lands; the literal bytes stay in the block's raw, so the source holds the shortcode
  verbatim (e.g. `Alpha:tada: lead …`) and only the widget count says it mounted
- a plain ArrowRight from the widget's leading edge steps the caret over the whole widget
  in one press, landing on the trailing edge, and a plain ArrowLeft steps back over it in
  one press: the `onEdge: 'step-over'` rule in both directions
- a single Backspace from the widget's trailing edge removes the whole shortcode in one
  press and one undo entry (`deleteGranularity: 'atomic'`), netting the document back to
  its loaded bytes

## Edge cases

- the mid-prose insert is not an end-of-document append, so the expectation tracker
  cannot predict it and each gesture waits for the widget swap and re-reads the state it
  actually got
- a caret that landed inside the widget (an offset strictly between the source start and
  end) fails the step-over gesture loudly, so a regression in the widget's edge behavior
  cannot record a corrupted caret as truth
- undo restores the whole deleted shortcode in one entry, then a second undo removes the
  mid-prose insert and returns to the loaded bytes

## User interactions

- the shortcode is typed with real per-character keyboard input at a mid-block caret
  placed by the selection API
- the step-over walks the caret to the widget's leading edge with real ArrowRight
  presses, then presses ArrowRight and ArrowLeft once each across the widget
- the whole-widget delete walks to the trailing edge with real arrow keys, then presses
  Backspace
- undo uses the real cross-platform shortcut around a forced batch boundary

## Error cases

- no console, page, or structured editor error fires across the session, including the
  `[invariant:…]` channel
- the live serializer round-trips the current CST at every checkpoint, and a reparse of
  that serialization matches the live tree at every checkpoint (the emoji bytes never
  split the tree, so that comparison is never waived)
- the nested-state audit finds no `BlockListState` out of sync after any insert,
  step-over, delete, or undo
