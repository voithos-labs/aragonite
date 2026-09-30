# Feature: Column move on a horizontally-overflowing table

Extends `reorder-column.md` to wide tables whose columns overflow `.table-block`'s
`overflow-x` and are partly scrolled off the right edge. Columns are never windowed, only
clipped, so the move itself is the ordinary one; what the wide case adds is that the caret
follows the column into the clipped region and the grid scrolls to keep it in view.

## Happy paths

- Alt+ArrowRight on the rightmost fully-visible column moves it past its clipped neighbour, the moved column's cell holds the caret, and the grid has scrolled so that cell is inside the table's visible box; a typed character lands in it.

## Edge cases

- The columns really do overflow at the start (scrollWidth exceeds clientWidth), and the moved column's neighbour is clipped, so the test cannot pass on a table that fits.

## Notes

- Retired with the column handles: the horizontal autoscroll at the pointer's edge that brought a clipped drop target into view mid-drag. The chord and the menu have no drop target to reach.
