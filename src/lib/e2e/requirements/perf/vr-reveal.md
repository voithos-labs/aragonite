# Feature: Virtual rendering, off-window reveal and off-window undo

Off-window blocks are absent from the DOM until a scroll brings them
in. Ctrl+Shift+End, scroll, and selection-collapse must scroll to, mount, and land the
caret in a block or cell that was windowed out at load: flat prose, nested list
items, and table cells alike. Undo of an edit whose block has been windowed out must
revert cleanly and restore focus.

## User interactions

- Ctrl+Shift+End from block 0 selects to the document end, collapsing the caret into the originally off-window last block; typing a character there lands it at the end of the source (exercises the cross-block scroll-and-await branch).
- After scrolling block 0 off-window, undo of an edit made in block 0 reverts cleanly: the typed character is removed from the source, no page error fires, and a subsequent type re-appears in block 0 (scrolling it back restored focus there). Undo's keydown is handled by a block, so a still-mounted block is focused first to route the keypress; undo itself belongs to the editor and still targets block 0, so block 0 must be scrolled back. Known windowing limitation: scrolling the caret's block past the limit on how far it is kept mounted drops the browser's focus, so Ctrl+Z does nothing until a mounted block holds focus.
- Undo fires after the caret's block is windowed out (F2): after an edit whose block scrolls out of the window, a mounted block is focused to route the Ctrl+Z keydown, and undo still reverts the off-window edit and scrolls the block back into view. Reverting the listener that focuses a mounted block leaves the keypress doing nothing and the typed character in place.

## Nested reveal (Phase 3)

- Reveal a deep off-window nested target: on a giant list, the deeply nested last leaf is unmounted at load; clicking the first item then Ctrl+Shift+End extends the cross-block selection to that leaf, and typing a character lands it at the end of the source, since `revealByPath` scrolled and mounted the off-window item.
- Collapse-to-start lands the caret in the off-window anchor item: on a giant list, Ctrl+Shift+End scrolls the window to the doc-end focus, so the row-0 anchor item is windowed out by collapse time. ArrowLeft collapses the cross-block selection to the start; the collapse must scroll to and focus item 0, so a typed character lands on source line 0 (the anchor item), not the focus item. A defect before the fix made the container's `revealByPath` depend on a stale component reference (an item scrolled off-window leaves a detached one behind), so it skipped mounting item 0, descended into the stale reference and hung, stranding the caret at the off-window focus item. The CST item count is also unchanged afterward (the body survives the collapse).

## Table reveal (Phase 4)

- Reveal an off-window cell by scroll: on a giant table, far rows are unmounted at load; scrolling near the bottom windows in a far row (idx well past the initial window), and clicking its cell + typing a character lands the edit in that now-mounted row and reaches the source.
- Reveal an off-window cell by keyboard extend: Ctrl+Shift+End inside a table cell normalizes the focus to a cell-coordinate endpoint at the table block; the extend reconstructs the deep cell path and scrolls to it, mounting the off-window last row (the active-endpoint pinned-caret invariant). Scrolling there takes the anchor cell off-window, so the caret used for dispatch is put at the start of the newly mounted cell to keep the next keystroke routed to a focused block.
- Collapse a keyboard table selection into the revealed cell: after Ctrl+Shift+End, ArrowRight collapses to the end and reconstructs the deep cell path so the caret lands at the end of the off-window cell (via the cell ref, since the cell-coordinate offset is a linear index, not a char offset); typing a character lands it in that last row and reaches the source.
- Collapse-to-start lands the caret in the off-window anchor cell: after Ctrl+Shift+End, ArrowLeft collapses the cross-block selection to the start (the row-0 anchor cell, scrolled off-window by the extend). The collapse must scroll to and focus row 0, so the active cell is row 0 and a typed character lands in row 0's first cell, not the focus cell. A defect before the fix made `revealByPath` depend on a stale component reference (a row scrolled off-window leaves a detached one behind), so it skipped mounting row 0 and the caret stranded in the off-window focus cell. The CST row count is also unchanged afterward (the body survives the collapse).

## Error cases

- No page errors (e.g. `state_unsafe_mutation`) surface during the reveal, scroll, or undo paths.
