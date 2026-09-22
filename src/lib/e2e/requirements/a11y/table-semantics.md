# Feature: Table structure for assistive tech

A GFM table's first row is always its header, so a screen reader in table navigation can name
each body cell by its column.

## Happy paths

- Every cell of row 0 carries `role="columnheader"`; every cell of a body row carries `role="cell"`.
- A document holding a table has no new axe violations.

## Miss-analysis

- The rendering spec asserted the cell count by `role="cell"`, which counted the header cells as
  plain cells, so the role it pinned was the wrong one and nothing read the header row's semantics.
