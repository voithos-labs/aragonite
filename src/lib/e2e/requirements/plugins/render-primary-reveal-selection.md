# Feature: a click that opens a render-primary leaf's source ends a live cross-block range

A render-primary leaf (block math, the outline, a footnote definition) shows its source when
clicked and puts a caret in it. That is a caret-placing gesture, so it has to end a live
cross-block selection exactly as a click on any block does. It used to open the source without
resetting the selection, leaving the range painted over a caret in the shown source, where the
next Backspace deleted the whole range.

## Happy paths

- Select the whole document, then click the rendered math: the cross-block selection ends.
- Backspace after that click edits the shown source and leaves the rest of the document alone.

## Edge cases

- Shift+click on the rendered view still extends the selection rather than resetting it, since
  opening the source ignores Shift by design and the reset has to ignore it with it.
