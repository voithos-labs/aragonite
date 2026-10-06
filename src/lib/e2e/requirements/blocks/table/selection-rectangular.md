# Feature: Table block, rectangular selection

## Happy paths

- Anti-diagonal drag (upper-right to lower-left) over a 3×3 table: once a rectangular intra-table mode is wired, it must paint the full bounding rectangle (a regression test for the `b840b18` measurePartialRects fix).

## Edge cases

- Rectangular intra-table drag (path-equal anchor/focus on the table) paints the overlay across the bounding rectangle.
- A rectangle inside one table (a drag from the top-left header cell to the middle cell of the first body row) paints only its own cells: no cell outside it, and nothing past the table's right edge. Miss-analysis: whether a range spans blocks was worked out again in the component that paints the space between blocks, and with that check gone the rectangle painted the cell beside it and the column past the table while every table and overlay row stayed green, since none of them looked outside the rectangle.
