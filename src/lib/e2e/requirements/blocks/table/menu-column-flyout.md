# Feature: Table block — the cell menu's Column flyout and alignment trio

The column actions of the right-click cell menu: insert left and right and move left and right
behind its "Column" entry, the delete and the alignment trio top-level. This is the pointer
road for what the `table.*` chords also reach (`shortcuts.md`, `reorder-column.md`); the
flyout's keyboard navigation is `a11y/table-menu.md`, and the cell menu's opening doors are
`affordance-menu-cell.md`.

## Happy paths

- Column flyout → "Insert column left" adds an empty column directly left of the clicked cell's column and closes the menu.
- Column flyout → "Move column left" on an interior column moves it past the previous column, header and body together.
- A flyout column move is one undo entry: a single Ctrl+Z restores the pre-move source.
- After a flyout column move the caret sits in the moved column, in the clicked row, so the next typed character lands there.
- The alignment trio shows the clicked column's current alignment as its active segment.
- Clicking a segment sets the clicked (non-first) column's alignment and closes the menu, leaving the other columns plain: Right serializes that column's delimiter to `---:`.

## Edge cases

- "Move column right" is disabled on the last column while "Move column left" stays enabled.
- "Delete column" is disabled when only one column remains; "Delete row" beside it stays enabled, since the two floors are independent.

## Notes

- Retired with the column grips: hover reveal, the grip's at-rest `pointer-events: none`, and the header-cell caret click surviving a hovered grip. No grip renders, so nothing intercepts the click.
