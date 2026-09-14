# Feature: the block rung, and dragging from a multi-click

Triple-click selects the block's content (a paragraph, a code body, a table cell), the same
range the first Ctrl+A press takes. Keep the mouse down on the second or third click and drag,
and the selection grows a word or a block at a time, forward or backward, inside the block and
across blocks; the word or block you pressed on is always in it. The browser owns none of this:
the second click cancels its native selection, so the editor's own drag session
(`selection/drag-pointer.ts`, `granularity`) paints the range inside the block and enters the
cross-block model for the rest.

## Happy paths

- triple-click inside a paragraph: that paragraph's content is selected
- triple-click past the end of a line, on no glyph: the paragraph, and it stays selected after
  the release
  - Miss-analysis: every multi-click pin pressed on a glyph, where the browser's release seats
    no caret; none pressed past a line's end, the one place the release does, so the range
    that vanished on release was never on screen in a spec
- triple-click in a quote's gutter (the quote's own box, left of its text): the quoted
  paragraph, the leaf nearest the press
- double-click on a list item's `- ` marker (an island inside the editable): the word beside
  it; the drag grip that sits in the gutter on hover is a control and stays out of the ladder
- double-click a word and drag forward within the block: the range grows a word at a time
  and ends at the end of the word under the pointer
- double-click a word and drag backward within the block: the range grows toward the start
  and keeps the pressed word
- double-click a word and drag into a following paragraph: a cross-block range from the
  pressed word's start to the end of the word under the pointer
- double-click a word and drag into a preceding paragraph: a cross-block range from the end
  of the pressed word to the start of the word under the pointer
- triple-click and drag into the next paragraph: both blocks whole

## Edge cases

- a word-drag that leaves the block and comes back: the cross-block range collapses to the
  range inside the block, and the release leaves a plain native range
- double-click a word in a table cell and drag along the cell: the cell's words join, and
  the table's own rectangle drag stays out of it
