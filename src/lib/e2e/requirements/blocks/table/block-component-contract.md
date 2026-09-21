# Feature: Table block, BlockComponent shallow/deep cursor contract

## Contract

A table is two-dimensional (row × column). The shallow `getCursorOffset()` integer cannot
hold both coordinates without losing one, so TableBlock returns `null` from the shallow
getter and reports its cursor through the deep `getCursorPosition()` path-and-offset
form instead. Selection and focus consumers (`readCurrentSelection`,
`createContainerBlockComponent`) already prefer the deep API where it is implemented;
returning null from the shallow getter stops a later round-trip through the unused path
from quietly losing the column.

## Happy paths

- Caret in cell (rowIdx=1, colIdx=1) of a top-level table: shallow `getCursorOffset()` returns `null`; deep `getCursorPosition()` returns the table-relative path `[1, 1]` with the within-cell offset.
- Caret in cell (rowIdx=0, colIdx=0): shallow `getCursorOffset()` still returns `null` even at the origin, since the contract is "a two-dimensional block never reports a shallow offset", not "(0,0) collapses to 0".

## Edge cases

- No cell focused: both shallow and deep return `null`.
