# Feature: cross-block clipboard — list marker preservation on copy

Regression coverage for list-marker correctness when cross-block copy spans or partially overlaps a list.

## Happy paths

- Copying across a full ordered list preserves every item marker (`1.`, `2.`, `3.`) in the clipboard text with no content duplication.
- Partial selection ending inside a single-child list item preserves that item's marker (e.g. `3. thi`).

## Regression notes

- Cross-block copy of a list with nested items does not duplicate content (container+leaf regression).
- Selecting the last list item through content below copies only that item — earlier items of the list are not promoted into the clipboard (over-promotion regression).
