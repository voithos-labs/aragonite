# Feature: Table block, clipboard out

## Happy paths

- 1×1 cell: Ctrl+A inside a cell, then Ctrl+C, copies the cell's plain text.
- A cell holding a widget (`<br>`): Ctrl+C copies the raw bytes (`a<br>b`), not the rendered textContent, which matches what Cut writes, so copy then paste round-trips the line break.
- Cross-block selection from a paragraph through a table to a paragraph below: Ctrl+C copies the leading paragraph text, the table's GFM raw, and the trailing paragraph text.

## Edge cases

- A 2×2 rectangle of cells, dragged, copies as a valid GFM sub-table.
- A second Ctrl+A in a cell selects the whole table, and its copy is the table's source, unchanged.

## Spreadsheet interchange

- A rectangle copy (and cut) also writes `text/html` holding a plain `<table>` of the same cells,
  which is the format Excel and Sheets read; `text/plain` stays the GFM sub-table, so a paste into
  prose is still a table and a paste into another table's cells is still a grid.
- The same rectangle copied while the table is scrolled out of the page (so the copy lands on the
  editor itself, not on a cell) writes the same two formats: the rectangle, not its whole rows.
  - Miss-analysis: every rectangle copy ran with the focus in a cell, whose own copy wrote the
    rectangle, so the editor's copy of the same selection was never read.

## User interactions

- Ctrl+A inside an empty cell with no text produces an empty clipboard string.

## Pinned below the browser

What a rectangle copy writes is a pure function of the table and two corners:

- A one-row rectangle (several columns) copies as a header-only sub-table: the header and the delimiter row, no body (`test/tree-operations/sub-table-copy.test.ts`).
- The sub-table keeps the source's column alignments for the columns it takes. From `| :--- | :---: | ---: |`, copying the second and third columns gives `:---:` and `---:` (`test/tree-operations/sub-table-copy.test.ts`).
