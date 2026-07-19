# Feature: Table block — clipboard out

## Happy paths

- 1×1 cell: Ctrl+A inside a cell, then Ctrl+C, copies the cell's plain text.
- A cell holding a widget (`<br>`): Ctrl+C copies the raw bytes (`a<br>b`), not the rendered textContent — matching what Cut writes, so copy→paste round-trips the line break.
- Cross-block selection from a paragraph through a table to a paragraph below: Ctrl+C copies the leading paragraph text, the table's GFM raw, and the trailing paragraph text.

## Edge cases

- 2×2 rectangular cell selection produces a valid GFM sub-table — pending Plan 4 input wiring that produces a path-equal anchor/focus on the table.
- Single-row rectangle (one row, multiple cols) produces a header-only sub-table (header + delimiter, no body) — pending Plan 4.
- Sub-table inherits column alignments sliced from the source — pending Plan 4. Concrete: from `| :--- | :---: | ---: |`, copying cols 0..1 yields `:---` and `:---:`.
- Whole-table copy after Ctrl+A 2nd press emits the table's raw — pending Plan 4 (2nd-press semantics).

## User interactions

- Ctrl+A inside an empty cell with no text produces an empty clipboard string.
