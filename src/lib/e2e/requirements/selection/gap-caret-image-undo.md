# Feature: undo back into a gap caret while an image is selected

An image selected whole and a gap caret (the caret that sits between a table and a code fence)
are two selections, and only one can be live. This file covers the one route that puts a gap
caret down while an image is still selected: an undo whose entry recorded the gap.

## Edge cases

- Type at the gap between a table and a fence (a paragraph appears), click an image above, then
  Mod+Z: the paragraph goes, the gap caret comes back at the same boundary, the image is no
  longer selected, and the next character typed makes a paragraph at the gap again
  - Miss-analysis: every gap caret spec reached the gap from a caret or a range, never with an
    image selected, and the gap caret's own placement ended a range or an older gap but nothing
    else, so the image stayed selected over the caret the undo put back

## User interactions

- The gap is reached by a click in the table's last cell and ArrowDown, the image is selected by
  a click on it, and the undo is Mod+Z.
