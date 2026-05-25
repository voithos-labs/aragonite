# Feature: Table block — BlockComponent shallow/deep cursor contract

## Contract

A table's surface is 2D (row × column). The shallow `getCursorOffset()` integer can't
losslessly encode both coordinates, so TableBlock returns `null` from the shallow
getter and reports its cursor via the deep `getCursorPosition()` path-and-offset
form instead. Selection and focus consumers (`readCurrentSelection`,
`createContainerBlockComponent`) already prefer the deep API when implemented;
nulling the shallow getter prevents future round-trips through the dead path
from silently losing the column.

## Happy paths

- Caret in cell (rowIdx=1, colIdx=1) of a top-level table: shallow `getCursorOffset()` returns `null`; deep `getCursorPosition()` returns the table-relative path `[1, 1]` with the within-cell offset.
- Caret in cell (rowIdx=0, colIdx=0): shallow `getCursorOffset()` still returns `null` even at the origin — the contract is "2D surfaces never report a shallow offset", not "(0,0) collapses to 0".

## Edge cases

- No cell focused: both shallow and deep return `null`.
