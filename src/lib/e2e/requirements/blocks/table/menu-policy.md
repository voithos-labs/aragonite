# Feature: Table block, cell menu dismissal and the switches it ignores

The right-click cell menu closes without committing on an outside click and on Escape, and it
hangs off neither of the editor's two switches: `blockDragHandles` governs the pointer handles
only, and reading mode, which has no change to offer, opens no menu at all.

## Happy paths

- Clicking outside the open menu closes it, and the source is untouched.
- Pressing Escape closes the open menu, and the source is untouched.
- With `blockDragHandles=false` the cell menu still opens and its Row flyout still moves the row: nothing the handles once reached is lost behind the handle switch.

## Edge cases

- In reading mode a right-click on a cell opens no table menu; the browser's own menu shows instead.

## Notes

- Retired with the handles: `blockDragHandles=false` removing them, reading mode hiding them, the touch gesture that showed them, and the cell grid keeping its tracks with them off. There is no handle to remove and no gutter track to drop.
