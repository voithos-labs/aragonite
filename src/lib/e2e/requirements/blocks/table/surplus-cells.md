# Feature: a body row wider than the header

GFM renders a table's body rows at the header's column count and ignores the cells past it (spec
example 204). Those cells are still bytes the file holds, so the table shows the header's count
and no edit in the row or the table drops them. The first edit may tidy the padding and the
delimiter row; it never drops text.

Miss-analysis: the table scenarios wrote rows as wide as their header, and the shape property's
retype gesture skipped table rows because of this very loss, so no test drove a write into one.

## Happy paths

- a row with one cell more than the header shows the header's column count
- typing in that row's rendered cell keeps the extra cell after it, byte for byte

## Edge cases

- typing in another row rebuilds the whole table and keeps the extra cell; one undo restores the file exactly
- deleting the header row makes the wide row the header: a header wider than its delimiter row is no table, so the table widens to take the extra cell as a column, and every other row pads to the new count; one undo puts the table back as it was

## User interactions

- real clicks into cells, End, typed keys, the delete-row chord and the undo chord

## Error cases

- zero `[invariant:…]` console fires (automatic via the shared e2e fixture)
