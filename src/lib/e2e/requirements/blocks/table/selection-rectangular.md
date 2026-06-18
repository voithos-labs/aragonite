# Feature: Table block — rectangular selection

## Happy paths

- Anti-diagonal drag (upper-right to lower-left) over a 3×3 table — once a rectangular intra-table mode is wired, must paint the full bounding rectangle (regression for `b840b18` measurePartialRects fix).

## Edge cases

- Rectangular intra-table drag (path-equal anchor/focus on the table) paints the overlay across the bounding rectangle.
