# Feature: Table block — selection

## Happy paths

- Drag from cell A to cell B in the same table enters cross-block selection (data-cross-block on editor root).
- Shift+click from cell A to cell B in the same table enters cross-block selection.
- Drag from a cell out of the table into a paragraph below enters cross-block selection.
- Drag from a paragraph above into a table cell enters cross-block selection.
- Anti-diagonal drag (upper-right to lower-left) over a 3×3 table — once a rectangular intra-table mode is wired, must paint the full bounding rectangle (regression for `b840b18` measurePartialRects fix).

## Edge cases

- Drag inside a single cell does not enter cross-block selection and paints no overlay.
- Drag from cell A to cell B then back to cell A leaves cross-block selection off.
- Rectangular intra-table drag (path-equal anchor/focus on the table) paints the overlay across the bounding rectangle.
