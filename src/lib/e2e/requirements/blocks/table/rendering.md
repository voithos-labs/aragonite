# Feature: Table block — rendering

## Happy paths

- A simple table loads and renders as a grid: each row appears as a row of cells, each cell is its own contenteditable.
- The table has `role="table"`; rows have `role="row"`; cells have `role="cell"`.
- Clicking inside a cell focuses that cell and places the cursor in it.
- Header row content shows; alignments parsed and stored in metadata (visible via `__test.dumpTree`).
- Column alignment metadata (`left` / `center` / `right`) is applied to each cell in that column as `text-align`, including cells whose source has no leading-space padding. `none` alignment leaves the cell at its inherited default.

## Edge cases

- A header-only table renders with one row, no body rows.
- A single-column table renders without breaking the grid.
- A table with escaped pipes (`\|`) in cells renders the escaped pipe as visible text in that cell.

## Structural invariants

- The table grid containers (`.table-block`, `.table-row`) have no whitespace-only direct child text nodes. Such a node joins the raw-offset walk (cursor/widget-offset.ts counts every text node, including aria-hidden grip markup) and shifts a parked cross-block caret, so the grip markup's block boundaries must stay adjacent.

## User interactions

- Typing in a cell mutates the cell's raw and the document round-trips with the new content.
- The table coexists with paragraphs above / below: typing in a paragraph above does not disturb the table.

## Error cases

- N/A — the parser and serializer are tested in unit tests.
