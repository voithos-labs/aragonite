# Feature: table rectangular selection by keyboard

Shift+Arrow inside a table grows a rectangular selection cell-by-cell. Vertical
extension moves a whole row; at the last/first row it exits the table into a
cross-block selection (the reverse of how a Shift+Arrow enters one).

## Happy paths

- Shift+ArrowDown from a body cell: focus moves down one row (same column) per
  press.
- Shift+ArrowUp mirrors it: focus moves up one row per press.

## Edge cases

- Shift+ArrowDown at the last row exits the table — focus lands on the block after
  the table (a cross-block selection).
- Shift+ArrowUp at the first row exits upward to the block before the table.

## Regression

- Pre-fix every Shift+ArrowDown snapped the focus to cellIdx 0 (the table's own
  first cell, reached by the block-level extend descending into the table) and the
  selection never left the table downward. The first press from a collapsed caret
  walked to the next doc-order cell (across), not down a row.
