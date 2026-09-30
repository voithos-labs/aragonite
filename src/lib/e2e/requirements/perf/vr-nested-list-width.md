# Feature: Virtual rendering, a nested list estimates at its own width

A list inside quotes is narrower than the editor, so its unmounted items take
more lines each than they would at the editor's width. The first height table a
list builds comes during its init, before its element exists, so it can only
guess at the scroll container's width; once the element mounts the list builds
again at its own width, and the guesses at the wrong width are not kept.

Driven on `/test/editor` over a list four quotes deep, with the dev perf
counters recording each height table build and the width it estimated at.

Miss-analysis: no spec measured a nested list's estimate against its own width;
the windowing suites handed every list its element before the first read.

## Happy paths

- after the load settles, the last height table the nested list built used its
  element's width, narrower than the editor's (regression #431: the only build
  used the scroll container's width, 1280 against a 1164 px list)
- with items long enough to wrap differently at the two widths, the bottom
  spacer below the window equals the guesses at the list's width for the items
  it stands for, not the guesses the first table made at the editor's width
  (miss-analysis: the first case read only the width of the last build, so a
  rebuild that kept the first table's guesses stayed green; only the unit saw it)

## Edge cases

- ten keystrokes in a nested item build no height table, once the first edit
  in the chain has been made
- a wheel scroll over the document builds no height table

## User interactions

- the load goes through the harness; the keystrokes are real typing after a
  click on the item; the scroll is a real wheel over the editor
