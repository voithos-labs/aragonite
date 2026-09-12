# Feature: Table block — pointer selection

## Happy paths

- Drag from cell A to cell B in the same table enters cross-block selection (data-cross-block on editor root).
- Shift+click from cell A to cell B in the same table enters cross-block selection.
- Drag from a cell out of the table into a paragraph below enters cross-block selection.
- Drag from a paragraph above into a table cell enters cross-block selection.

## Edge cases

- Drag inside a single cell does not enter cross-block selection and paints no overlay.
- Drag from cell A to cell B then back to cell A leaves cross-block selection off.
- Ctrl+Shift+End from a body cell of a small (unwindowed) table, then collapse-to-end (ArrowRight): the caret lands in the last cell, not at a stray linear offset on the grid.

## Error cases

- Ctrl+Shift+End from a body cell, then ArrowLeft (collapse-to-start) then type: the table body survives (no range-replace wipe) and the marker lands in the anchor cell. Regression for the cell dispatching cellKeydownPlan before cross-block.
- Ctrl+Shift+End from a body cell, then ArrowDown (collapse-to-end) then type: the table body survives and the marker lands in the last cell. (ArrowDown is claimed unconditionally by the cell plan, so it wiped where ArrowRight lucked out.)
- Repeated Ctrl+A presses in a cell (cell → document, a third press changing nothing) leave the whole document selected — the cross-block-first gate must not break the stepped select-all.
