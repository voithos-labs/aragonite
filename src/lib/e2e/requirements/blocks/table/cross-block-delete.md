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
- Whole-table intra-table selection (Ctrl+A 2nd press) + Backspace clears every cell, preserves
  the table structure (row count, column count, alignments) and keeps the header row marked.

## User interactions

- A single Ctrl+Z restores the document after a cross-block delete that traverses a table.

## Notes

- Cases 1, 2, and the whole-table clear are presently `test.fixme`. The Plan 5 Task 5 implementation
  mutates cell `raw` but does not rebuild the affected row `raw`, so `rebuildTableRaw` reads stale
  row `raw` values and the cleared cells do not appear in the serialized source. Unit coverage in
  `range-delete-table.test.ts` passes because it asserts per-cell `.raw`, not serialize() output.
- The Backspace-at-first-cell navigation case is `test.fixme`. The cell handler calls
  `focusActions.moveFocus(myPath[0] - 1, 'end')`, but its `focusActions` is the table's nested
  bundle — index 0 there is a row (non-focusable) rather than the sibling block above the table.
  ArrowUp routes through `tableContext.exitUpward` and works correctly.
