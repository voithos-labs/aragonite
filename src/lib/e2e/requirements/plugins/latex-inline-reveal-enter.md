# Feature: Enter inside a shown inline source

Enter is the block's split key everywhere else in the editor, and a shown source used to take it as a commit gesture instead. That cost the user the keypress twice over: at an edge of the source it moved the caret past the widget rather than pushing content down, and on a source already broken into plain text it did nothing visible, so the split needed a second press. Enter now commits the edit and splits at the caret, through the same commit-first path as the other block commands (`latex-inline-reveal-commands.md`). Escape is the only key a shown source still takes for itself.

A table cell is the deliberate exception, pinned with the cell (`blocks/table/cell-inline-reveal.md`): Enter in a cell moves to the next row, and moving would carry an edit the tree has not seen out of the cell that owns it, so there Enter commits and the caret stays put.

## Happy paths

- Enter at the leading edge of a shown source splits the block there: the content moves down and the caret stays before the math rather than past it
- Enter after the shown source has been broken into plain text splits on the first press
- Enter mid-source commits the edit as it splits, so the structural operation does not throw the edit away

## User interactions

- Real keyboard only: move the caret against the widget's edge to show the source, type into it for real, press a real Enter. Where the caret is gets asserted by typing a marker character rather than by reading the source, which is right wherever focus ended up.

## Error cases

- No `[invariant:…]` message and no page error across showing the source, editing it and pressing Enter
