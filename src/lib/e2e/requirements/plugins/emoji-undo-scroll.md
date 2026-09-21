# Feature: an undo that restores a glyph widget leaves the scrollport alone

Deleting one `:sunny:` reference and undoing it edits a single block, so neither gesture may
move what the user is looking at. Driven on `/test/plugins?seed=emoji` with the showcase's own
"Punishing Evil" section between two runs of filler, switched into live through the harness's
mode control after load, at two scroll positions: with the shortcode's list just below the fold,
and with it inside the viewport. The gestures under test are the click, the Backspace and the
Ctrl+Z.

The mode switch is setup, but it is not incidental: it drops every measured height, and the
undo's document swap is the next thing to rebuild a block list's height table from that cache,
so the pair is what catches a rebuild that trades measurements for estimates.

What the test reads is the block the user's eyes are on, together with the scroll number.
Estimating the whole document again moves both, and either one on its own can stay put by
accident.

The fixture sits below the size at which windowing starts, on purpose, so every block is
mounted. The rebuild and the scroll correction that holds a block in place run whether a list
windows or not, and a document that windows nothing is the shape where re-estimating cannot hide
behind a spacer.

Miss-analysis (#320): the mode switch dropping the heights was pinned from the estimator's side
(the cache empties) and from the resize side (a block that moves is measured again), and every
windowing suite that rebuilds a height table does it with the cache intact, so the one order
that reads a dropped cache had no scenario at any layer.

## Happy paths

- delete the reference with the list below the fold, then undo: the scroll number and the
  leading block are exactly what they were before the delete
- the same with the list inside the viewport

## User interactions

- the caret is placed by a real click on the glyph's right half, the delete is one Backspace on
  the widget, which deletes as one, and the undo is Ctrl+Z

## Error cases

- no `[invariant:…]` console messages across any scenario (automatic through the shared e2e
  fixture)
