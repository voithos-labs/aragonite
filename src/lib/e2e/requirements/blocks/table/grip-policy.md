# Feature: Table block — the grips follow `blockDragHandles`

The row and column grips are the table's share of the editor's one mouse-affordance switch.
`blockDragHandles=false` takes them out of the DOM entirely, the way it does the block drag
handle, and reading mode does the same whatever the flag says. Nothing the grips reach is lost:
the same row and column actions stay on the cell right-click, on Shift+F10, and on the `table.*`
chords.

## Happy paths

- With handles on (the harness default), hovering the table shows one column grip per column and one row grip per row.
- With `blockDragHandles=false` the table renders no row or column grip, even while hovered.
- In reading mode the grips are absent whichever way the flag is set.

## Edge cases

- Dropping the grips leaves the cell grid on the same tracks: the first cell keeps the x and the width it has with grips on, so caret geometry and the sticky column read the same either way.

## Notes

- Miss-analysis: `blocks/reorder-handle.spec.ts` pinned the policy at the block handle, and nothing asked whether the editor's other mouse-only affordances honour it, so the table's grips were a second render site no test had listed.
- The grips gate the mouse affordance only. The menu they open is covered by `affordance-menu-row.md` and `affordance-menu-column.md`, its keyboard and right-click doors by `affordance-menu-cell.md` and `a11y/table-menu.md`.
