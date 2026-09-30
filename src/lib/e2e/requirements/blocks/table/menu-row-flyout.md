# Feature: Table block, the cell menu's Row flyout

The row actions of the right-click cell menu, behind its "Row" entry: insert above and below,
move up and down. The two deletes stay top-level. This is the pointer route to what the
`table.*` chords also reach (`shortcuts.md`, `reorder-row.md`); the flyout's keyboard
navigation is `a11y/table-menu.md`, and how the cell menu opens is
`affordance-menu-cell.md`.

## Happy paths

- Row flyout → "Insert row above" adds an empty body row directly above the clicked cell's row and closes the menu.
- Row flyout → "Move row up" on an interior body row moves it above the previous body row.
- A flyout move is one undo entry: a single Ctrl+Z restores the source as it was before the move.
- After a flyout move the caret sits in the moved row, in the clicked column, so the next typed character lands there.

## Edge cases

- The header row cannot move: its flyout offers the inserts, and both moves are disabled.
- "Move row down" is disabled on the last body row while "Move row up" stays enabled.
- "Delete row" is disabled when only one body row remains, and a forced click on it commits nothing; "Delete column" beside it stays enabled, since the two limits are independent.

## Notes

- Retired with the row handles: the hover that showed them, their `pointer-events: none` at rest, and a caret click on the first cell surviving a hovered handle. No handle renders, so nothing intercepts the click.
