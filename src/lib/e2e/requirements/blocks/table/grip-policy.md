# Feature: Table block — the grips follow `blockDragHandles`

The row and column grips are the table's share of the editor's one pointer-affordance switch.
`blockDragHandles=false` takes them out of the DOM entirely, the way it does the block drag
handle, and reading mode does the same whatever the flag says. Nothing the grips reach is lost:
the same row and column actions stay on the cell right-click, on Shift+F10, and on the `table.*`
chords.

## Happy paths

- With handles on (the harness default), hovering the table shows one column grip per column and one row grip per row.
- With `blockDragHandles=false` the table renders no row or column grip, even while hovered.
- In reading mode the grips are absent whichever way the flag is set.
- On a touch device, where nothing can hover the table, the grips are opaque without a
  gesture and a tap lands on one: the row menu opens rather than the cell behind it taking
  the caret.

## Edge cases

- Dropping the grips leaves the cell grid on the same tracks: the first cell keeps the x and the width it has with grips on, so caret geometry and the sticky column read the same either way.

## Notes

- Miss-analysis: `blocks/reorder-handle.spec.ts` pinned the policy at the block handle, and nothing asked whether the editor's other pointer affordances honour it, so the table's grips were a second render site no test had listed.
- Miss-analysis (touch): every grip scenario opened with `page.hover`, which is the one
  gesture a phone cannot make, so a reveal keyed on hover alone read as present in every
  run and both affordances behind `blockDragHandles` were unreachable there.
- The grips gate the pointer affordance only. The menu they open is covered by `affordance-menu-row.md` and `affordance-menu-column.md`, its keyboard and right-click doors by `affordance-menu-cell.md` and `a11y/table-menu.md`.
