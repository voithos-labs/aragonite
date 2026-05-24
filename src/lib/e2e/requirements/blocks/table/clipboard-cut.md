# Feature: Table block — clipboard cut

End-to-end coverage for `Ctrl+X` (Cut) originating inside a table cell.
Mirrors the three branches of the cell's `onCopy` — intra-cell, intra-table
multi-cell rectangle, and cross-block — and verifies that the deletion side
of Cut routes through the same paths as Backspace/Delete.

## Happy paths

- Intra-cell Cut: shift-select text inside a single cell, Ctrl+X. The
  clipboard receives the selected text; the cell raw reflects the deletion;
  the caret lands at the deletion seam; pasting into a paragraph below
  reproduces the cut text.
- Intra-table multi-cell Cut: drag-select a sub-rectangle inside the table,
  Ctrl+X. The clipboard receives a valid GFM sub-table (header + delimiter
  for row 0, otherwise header-less). The selected cells are cleared in
  place; the table's row/column structure is preserved.
- Cross-block Cut originating in a cell: anchor inside a cell,
  Shift+ArrowDown into the following paragraph, Ctrl+X. The clipboard
  contains the cross-block range (cell tail + paragraph head). The DOM
  reflects the cross-block delete — the originating row's cells are cleared
  and the trailing paragraph head is dropped (or the paragraph itself if
  the focus reaches its tail).

## Edge cases

- A single Ctrl+Z after any of the three Cut variants restores the
  pre-cut document in one undo entry.

## User interactions

- Real keyboard events drive every Cut. No programmatic clipboard API
  writes — the test must exercise the same synchronous
  `clipboardData.setData` path the user hits via Ctrl+X.
