# Feature: Virtual rendering, edits and unmounts away from the fold

Content that changes outside the mounted band must not move what the user is looking at.
Three mechanisms, three reverts: remapping the held block by stable id, holding a column's
width, and the structural correction's check for no local anchor.

## Happy paths

- Inserting a block above the fold holds the viewport (F4): the insert shifts every index below it, so an anchor addressed by number measures a different block's offset and over-corrects by ~one block height. Remapping by stable id holds the visible content's Y; reverting the remap fails the held-Y bound. Driven programmatically in a nested list, since blocks above the fold are unmounted, so there is no clickable target and undo would scroll.
- A column does not shrink when its widest cell scrolls out of the window (F6): the editor holds a table column at its measured max even after its widest cell unmounts; removing that hold lets the column collapse toward the narrow rows' width after the scroll.
- Reordering a list item below the fold does not drift `scrollTop` (F7): when the list's child list has no content scrolled above the viewport top (`localScrollTop === 0`), one Alt+Up + Alt+Down no-op reorder cycle must return `scrollTop` to baseline. The structural anchor correction would otherwise follow the block it holds to its new place and shift the shared `scrollTop`, which drifts by a different amount on each keypress.

## Edge cases

- Each fixture is non-uniform: in a uniform document the inserted block matches the old occupant of index N and the numeric delta comes out accidentally correct.
- The F6 case asserts the wide row really left the DOM, or the column stays wide for the wrong reason.
- The F7 case asserts the list sits below the viewport top before reordering, or the buggy branch is never reached.

## Error cases

- No page errors surface during the insert, scroll-away, or reorder paths.
