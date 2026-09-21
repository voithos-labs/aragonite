# Feature: Table block, the cell menu's Column flyout and alignment trio

The column actions of the right-click cell menu: insert left and right and move left and right
behind its "Column" entry, with the delete and the three alignment buttons top-level. This is the
pointer route to what the `table.*` chords also reach (`shortcuts.md`, `reorder-column.md`); the
flyout's keyboard navigation is `a11y/table-menu.md`, and how the cell menu opens is
`affordance-menu-cell.md`.

## Happy paths

- Column flyout → "Insert column left" adds an empty column directly left of the clicked cell's column and closes the menu.
- Column flyout → "Move column left" on an interior column moves it past the previous column, header and body together.
- A flyout column move is one undo entry: a single Ctrl+Z restores the source as it was before the move.
- After a flyout column move the caret sits in the moved column, in the clicked row, so the next typed character lands there.
- The three alignment buttons show the clicked column's current alignment as the active one.
- Clicking one sets the clicked (non-first) column's alignment and closes the menu, leaving the other columns plain: Right serializes that column's delimiter to `---:`.

## Edge cases

- "Move column right" is disabled on the last column while "Move column left" stays enabled.
- "Delete column" is disabled when only one column remains; "Delete row" beside it stays enabled, since the two limits are independent.

## Notes

- Retired with the column handles: the hover that showed them, their `pointer-events: none` at rest, and a caret click on a header cell surviving a hovered handle. No handle renders, so nothing intercepts the click.
