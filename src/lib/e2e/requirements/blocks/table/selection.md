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
- Ctrl+Shift+End from a body cell of a small (unwindowed) table, then collapse-to-end (ArrowRight): the caret lands in the last cell, not at a stray linear offset on the grid.

## Error cases

- Ctrl+Shift+End from a body cell, then ArrowLeft (collapse-to-start) then type: the table body survives (no range-replace wipe) and the marker lands in the anchor cell. Regression for the cell dispatching cellKeydownPlan before cross-block.
- Ctrl+Shift+End from a body cell, then ArrowDown (collapse-to-end) then type: the table body survives and the marker lands in the last cell. (ArrowDown is claimed unconditionally by the cell plan, so it wiped where ArrowRight lucked out.)
- Three Ctrl+A presses in a cell (cell → table → document) still select the whole document — the cross-block-first gate must not break the 3-stage select-all.
