# Feature: Sticky-column entry into a row-windowed table (VR-K1)

## Happy paths

- On a row-windowed giant table scrolled past row 0 (header unmounted), arrowing down out of the last row's rightmost cell into a paragraph below captures the sticky-X, and arrowing back up re-enters the last row at the column nearest that X — not column 0. Column geometry is read from a currently-mounted row (columns share grid track widths), so it survives row 0 windowing out.

## Regression notes

- The pre-fix `collectColumnRects` queried the hard-coded header row (`[data-table-row-idx="0"]`); once row 0 windows out its rects are empty and `columnNearestX([])` collapses the caret to column 0. Asserted on the focus path's exact column index, with the row-0-unmounted + spacers-present precondition pinned at the decisive instant so the regression can't pass vacuously.
