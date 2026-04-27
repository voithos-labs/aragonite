# Feature: Table block — selection

## Happy paths

- Drag from cell A to cell B in the same table enters cross-block selection (data-cross-block on editor root).
- Shift+click from cell A to cell B in the same table enters cross-block selection.
- Drag from a cell out of the table into a paragraph below enters cross-block selection.
- Drag from a paragraph above into a table cell enters cross-block selection.
- Anti-diagonal drag (upper-right to lower-left) over a 3×3 table — once a rectangular intra-table mode is wired, must paint the full bounding rectangle (regression for `b840b18` measurePartialRects fix).

## Edge cases

- Drag inside a single cell paints the native browser selection over that cell's text — no overlay appears (pending drag-pointer support for cells).
- Drag from cell A to cell B then back to cell A collapses the selection — pending drag-pointer support for cells (Plan 4).
- Rectangular overlay painting for intra-table cell selections (path-equal anchor/focus on the table) — pending Plan 4 keyboard vocabulary that produces such selections.
