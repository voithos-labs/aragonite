# Feature: Table block, cross-block delete

End-to-end coverage for cross-block range-delete through tables (rangeDelete table-aware branch).

A table that is an endpoint of a cross-block selection snaps to whole rows, so
the highlight, clipboard copy, and delete all agree on the same cells (see
`selection-whole-row-snap.md`). The mid-row cases below therefore clear whole
rows, not partial cells. This holds however the selection was made, by keyboard
extension, by a drag into a table, or by a drag that starts in a cell, because
all of them flag the table endpoints as cell coordinates.

## Happy paths

- Case 1 (paragraph above → cell mid-table): drag from paragraph head into a body cell, Backspace.
  Anchor paragraph head preserved; every row the selection touches is cleared in full and rows
  fully covered are removed; if the header row is consumed, the next surviving row is promoted to
  header. Surviving paragraph and surviving table remain adjacent (no merge).
- Case 2 (cell mid-table → paragraph below): drag from a body cell into the paragraph below, Backspace.
  The anchor cell's entire row (and every row below it) is cleared or removed; the head of the
  paragraph below is dropped. Surviving table + surviving paragraph remain adjacent.
- Case 2 into a nested prose end (cell mid-table → paragraph inside a blockquote): drag from a body
  cell into a quoted paragraph, Delete. The nested endpoint (path length 2) goes through the
  cross-container commit that changes the live document, so the reparsed tail must be read again from
  the tree rather than matched by node identity, or the lookup for the survivor's path throws. The
  result: the table truncates to its surviving header, the blockquote keeps its tail as its own block
  (no merge), no page or editor error fires, the document round-trips, and a single Ctrl+Z restores it.
- Case 3 (full-table span: paragraph above → table → paragraph below): the table is consumed in full,
  the anchor paragraph tail is dropped, the focus paragraph head is dropped, and the two paragraphs
  merge into one block.

## Edge cases

- Backspace at offset 0 of the first cell of the first row navigates to the previous block: the
  table is not modified, and no cross-block delete fires.

## Coverage-driven intra-table delete

Intra-table Backspace dispatches by what the selection covers:

- Whole-table coverage (every cell selected, by a second Ctrl+A press, say): delete the table block. When
  the table is the document's only block, an empty paragraph replaces it in the same undo entry so
  the document keeps ≥1 editable block, the caret lands in it (offset 0), and a single Ctrl+Z
  restores the original table.
- Whole-row coverage (every cell of one row, no cells from other rows): delete the row. It does
  nothing when only the header row would survive (≥1 body row required), mirroring Ctrl+Shift+Backspace.
  Deleting the header row promotes the next row to header.
- Whole-column coverage (every row's same column, no other columns): delete the column. It does
  nothing when only one column remains (≥2 columns required), mirroring Alt+Shift+Backspace.
- Subset / mixed coverage: clear the selected cells and preserve the table structure.

## User interactions

- A single Ctrl+Z restores the document after a cross-block delete that crosses a table or
  triggers a coverage-driven row/column/table delete.
- Entering the cross-block selection by **keyboard** (Shift+ArrowDown from a cell into the
  paragraph below) produces the same table-aware delete as a pointer drag: the table endpoint is
  held as a cell index (`[tableIdx]` + cell), not as a deep path to a cell leaf, so the delete never
  falls through to the generic merge that would fuse paragraph text into a cell.
- Typing a character over a cross-block selection spanning two **separate top-level tables** lands
  the typed character inside a surviving cell of the start table, and never slices the table's grid
  markup (`| A | B |`) mid-row. Both table endpoints are flagged cell coordinates, so the whole-row
  snap removes the touched rows in each table and the collapsed caret is a deep path to a surviving
  cell with a character offset, not a cell-index offset on the table block.
