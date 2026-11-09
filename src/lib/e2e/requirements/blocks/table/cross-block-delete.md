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
  Anchor paragraph head preserved; every body row the selection touches goes in full, and the
  header row with its delimiter stays, since a range entering a table below its header keeps it.
  Surviving paragraph and surviving table remain adjacent (no merge).
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

Backspace, Delete and cut over cells of one table go by what the selection covers:

- Whole-table coverage (every cell selected, by a second Ctrl+A press, say): delete the table block. When
  the table is the document's only block, the commit leaves an empty paragraph in its place (every
  delete that takes a document's last block does), the caret lands in it (offset 0), and a single
  Ctrl+Z brings the table back.
- Whole-table coverage with a paragraph above and below: Backspace lands the caret at the end of
  the one above, so a typed `x` joins its text.
  - Miss-analysis: the whole-table cases all used a table alone in the document, so where the
    caret went beside neighbours was never read.
- The same with Delete: the caret lands at the start of the paragraph below, the side Delete
  points, so a typed `x` opens it.
  - Miss-analysis: only Backspace was ever pressed over a whole table, and the whole-table route
    picked its side on its own, so it kept Backspace's side for Delete too.
- Typing over a whole table (a second Ctrl+A in a table that's the document's only block, then
  `x`) replaces the table with a paragraph holding `x`. A cut over it removes the table, the way
  Backspace does.
  - Miss-analysis: every whole-table row pressed Backspace, so typing and cut over the same range
    kept clearing the cells and nobody looked.
- Whole-row coverage (every cell of one row, no cells from other rows): delete the row. It does
  nothing when only the header row would survive (≥1 body row required), mirroring Ctrl+Shift+Backspace.
  Deleting the header row promotes the next row to header.
- Whole-column coverage (every row's same column, no other columns): delete the column. It does
  nothing when only one column remains (≥2 columns required), mirroring Alt+Shift+Backspace.
- Subset / mixed coverage: clear the selected cells and preserve the table structure.
- A whole table inside a quote or a list item goes, and the quote or item stays with its line
  emptied (`> `, `- `), since the range holds the table and not its container (the paragraph
  below stays). One Ctrl+Z brings the table back.

## User interactions

- A single Ctrl+Z restores the document after a cross-block delete that crosses a table or
  triggers a coverage-driven row/column/table delete.
- Entering the cross-block selection by **keyboard** (Shift+ArrowDown from a cell into the
  paragraph below) produces the same table-aware delete as a pointer drag: the table endpoint is
  held as a cell index (`[tableIdx]` + cell), not as a deep path to a cell leaf, so the delete never
  falls through to the generic merge that would fuse paragraph text into a cell. From the last
  row, the range takes the whole table and the paragraph stays.
- Typing a character over a cross-block selection spanning two **separate top-level tables**, from
  a body row of the first into the header of the second, never slices the grid markup
  (`| A | B |`) mid-row: the first table keeps its header, the second goes whole, and the typed
  character opens a paragraph after the first table, where the caret the removal left sits between
  blocks.
  - Miss-analysis: the boundary caret a removal can leave was only ever met by Delete, so no row
    typed at one.

## Pinned below the browser

A whole row or column goes, and a row or column of a table at any depth goes the same way, with the caret landing in the cell that took its place and one Ctrl+Z bringing it back (`test/selection/cross-block/nested-grid-coverage-delete.test.ts`, run for a top-level table, a quote, a list item, a quote in a quote and an open details). The drag itself is held by the whole-table, partial-range and header-only drag rows above.

Miss-analysis: every coverage row used a top-level table, and Backspace only asked what a selection covers when it sat at the top level, so a nested table got its cells cleared and no test ever looked.
