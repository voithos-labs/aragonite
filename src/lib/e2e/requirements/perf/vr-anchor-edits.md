# Feature: Virtual rendering — edits and unmounts away from the fold

Content that changes outside the mounted band must not move what the reader is looking at.
Three mechanisms, three reverts: the stable-id anchor remap, the column-width pin, and the
structural correction's no-local-anchor guard.

## Happy paths

- Inserting a block above the fold holds the viewport (F4): the insert shifts every index below it, so a numeric anchor measures a DIFFERENT block's offset and over-corrects by ~one block height. Remapping by stable id holds the visible content's Y; reverting the remap fails the held-Y bound. Driven programmatically at a nested scope — above-fold blocks are unmounted, so there is no clickable target and undo would scroll.
- A column does not shrink when its widest cell scrolls out of the window (F6): the column-width pin holds a table column at its measured max even after its widest cell unmounts; reverting the pin lets the column collapse toward the narrow rows' width after the scroll.
- Reordering a list item below the fold does not drift scrollTop (F7): when the list scope has no content scrolled above the viewport top (localScrollTop === 0), one Alt+Up + Alt+Down no-op reorder cycle must return scrollTop to baseline. The structural anchor correction would otherwise follow the relocated anchor block and shift the shared scrollTop (asymmetric per-press drift pre-fix).

## Edge cases

- Each fixture is non-uniform: in a uniform document the inserted block matches the old occupant of index N and the numeric delta comes out accidentally correct.
- The F6 arm asserts the wide row really left the DOM, or the column stays wide for the wrong reason.
- The F7 arm asserts the list sits below the viewport top before reordering, or the buggy branch is never reached.

## Error cases

- No page errors surface during the insert, scroll-away, or reorder paths.
