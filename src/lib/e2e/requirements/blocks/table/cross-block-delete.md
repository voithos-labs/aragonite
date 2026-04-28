# Feature: Table block — cross-block delete

End-to-end coverage for cross-block range-delete through tables (rangeDelete table-aware branch).

## Happy paths

- Case 1 (paragraph above → cell mid-table): drag from paragraph head into a body cell, Backspace.
  Anchor paragraph head preserved; cells in `[0..focusCellIdx)` cleared; rows fully covered by the
  range removed; if the header row is consumed, the next surviving row is promoted to header.
  Surviving paragraph and surviving table remain adjacent (no merge).
- Case 2 (cell mid-table → paragraph below): drag from a body cell into the paragraph below, Backspace.
  Cells `[startCellIdx..lastCell]` cleared; rows below the start row removed; head of the
  paragraph below dropped. Surviving table + surviving paragraph remain adjacent.
- Case 3 (full-table span: paragraph above → table → paragraph below): the table is consumed in full,
  the anchor paragraph tail is dropped, the focus paragraph head is dropped, and the two paragraphs
  merge into one block.

## Edge cases

- Backspace at offset 0 of the first cell of the first row navigates to the previous block — the
  table is not modified, no cross-block delete fires.

## Coverage-driven intra-table delete

Intra-table Backspace dispatches by what the selection covers:

- Whole-table coverage (every cell selected, e.g. Ctrl+A 2nd press): delete the table block.
- Whole-row coverage (every cell of one row, no cells from other rows): delete the row. No-op
  when only the header row would survive (≥1 body row required), mirroring Ctrl+Shift+Backspace.
  Deleting the header row promotes the next row to header.
- Whole-column coverage (every row's same column, no other columns): delete the column. No-op
  when only one column remains (≥2 columns required), mirroring Alt+Shift+Backspace.
- Subset / mixed coverage: clear the selected cells and preserve the table structure.

## User interactions

- A single Ctrl+Z restores the document after a cross-block delete that traverses a table or
  triggers a coverage-driven row/column/table delete.
