# Feature: Table block, clipboard cut

End-to-end coverage for `Ctrl+X` (Cut) starting inside a table cell.
It mirrors the three branches of the cell's `onCopy` (intra-cell, intra-table
multi-cell rectangle, and cross-block) and checks that the deletion side
of Cut goes through the same paths as Backspace/Delete.

## Happy paths

- Intra-cell Cut: shift-select text inside a single cell, Ctrl+X. The
  clipboard receives the selected text; the cell raw reflects the deletion;
  the caret lands where the deletion joined the two halves; pasting into a
  paragraph below reproduces the cut text.
- Intra-table multi-cell Cut: drag-select a sub-rectangle inside the table,
  Ctrl+X. The clipboard receives a valid GFM sub-table (header + delimiter
  for row 0, otherwise header-less). The selected cells are cleared in
  place; the table's row/column structure is preserved.
- Cross-block Cut starting in a cell: anchor inside a cell,
  Shift+ArrowDown into the following paragraph, Ctrl+X. The clipboard
  contains the cross-block range (cell tail + paragraph head). The DOM
  reflects the cross-block delete: the starting row's cells are cleared
  and the trailing paragraph head is dropped (or the paragraph itself if
  the focus reaches its tail).

## Edge cases

- A single Ctrl+Z after any of the three Cut variants restores the
  document as it stood before the cut, in one undo entry.
- Partial-column cross-block Cut (drag from a block above into a mid-row,
  mid-column cell): the clipboard text and the surviving table cells are
  exactly complementary, so every body cell is either copied (and removed) or
  surviving (and not copied), never both and never neither. The whole-row snap
  makes copy and delete take the same rows.
- Partial-column cross-block Cut anchored in a mid-cell (the drag starts in a
  mid-row, mid-column cell and exits to a block above): the same complementary
  guarantee. The drag's starting point is the table endpoint here, so it must
  carry the cell-coordinate flag for the snap to fire; otherwise the copy
  rounds to whole rows while the delete clears from the mid-cell.

## User interactions

- Real keyboard events drive every Cut. Nothing writes to the clipboard
  programmatically: the test must exercise the same synchronous
  `clipboardData.setData` path the user reaches with Ctrl+X.
