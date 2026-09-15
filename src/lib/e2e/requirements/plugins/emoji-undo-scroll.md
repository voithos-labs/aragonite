# Feature: an undo that restores a glyph widget leaves the scrollport alone

Deleting one `:sunny:` reference and undoing it edits a single block, so neither
gesture may move the reader. Driven on `/test/plugins?seed=emoji` with the showcase's
own "Punishing Evil" section between two runs of filler, flipped into live through the
harness mode door after load, at two scroll positions: the shortcode's list just below
the fold, and inside the viewport. The gestures under test are the click, the Backspace
and the Ctrl+Z.

The flip is setup, but it is not noise: it drops every measured height, and the undo's
document swap is the next thing to rebuild a scope's model from that cache, so the pair
is what catches a rebuild that trades measurements for estimates.

The oracle is the block the reader's eyes are on together with the scroll number: a
document-wide reseed moves both, and either alone can be held by accident.

The fixture sits under the windowing watermark on purpose, so every block is mounted.
The rebuild and its anchor correction run whether a scope windows or not, and an
unwindowed document is the shape where a reseed cannot hide behind a spacer.

Miss-analysis (#320): the flip's drop was pinned from the oracle's side (the cache
empties) and the resize side (a block that moves re-measures), and every windowing
suite that rebuilds a model does it with the cache intact, so the one ordering that
reads a dropped cache had no scenario at any layer.

## Happy paths

- delete the reference with the list below the fold, then undo: the scroll number and
  the leading block are exactly what they were before the delete
- the same with the list inside the viewport

## User interactions

- the caret is seated by a real click on the glyph's right half, the delete is one
  Backspace on the atomic widget, and the undo is Ctrl+Z

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared
  e2e fixture)
