# Feature: Sticky-column entry into a row-windowed table (VR-K1)

## Happy paths

- On a row-windowed giant table scrolled past row 0 (header unmounted), arrowing down out of the last row's rightmost cell into a paragraph below captures the sticky-X, and arrowing back up re-enters the last row at the column nearest that X, not column 0. Column geometry is read from a row that is currently mounted (columns share grid track widths), so it survives row 0 being unmounted.

## Regression notes

- `collectColumnRects` used to query the hard-coded header row (`[data-table-row-idx="0"]`); once row 0 is unmounted its rects are empty and `columnNearestX([])` collapses the caret to column 0. The test checks the exact column index the focus path gives, with "row 0 unmounted and spacers present" pinned at the decisive instant so the regression cannot pass for the wrong reason.
