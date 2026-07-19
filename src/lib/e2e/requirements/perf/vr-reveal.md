# Feature: Virtual rendering — off-window reveal and off-window undo

Off-window blocks are absent from the DOM until a scroll or a reveal brings them
in. Ctrl+Shift+End, scroll, and selection-collapse must reveal, mount, and land the
caret in a block/cell that was windowed out at load — for flat prose, nested list
items, and table cells. Undo of an edit whose block has been windowed out must
revert cleanly and restore focus.

## User interactions

- Ctrl+Shift+End from block 0 selects to the document end, collapsing the caret into the originally off-window last block; typing a marker there lands the marker at the end of the source (exercises the cross-block reveal scroll-and-await branch).
- After scrolling block 0 off-window, undo of an edit made in block 0 reverts cleanly: the marker is removed from the source, no page error fires, and a subsequent type re-appears in block 0 (the reveal restored focus there). Undo's keydown is block-scoped, so a still-mounted block is focused first to route the key press; undo itself is editor-global and still targets block 0, so the reveal must scroll it back. Known VR limitation: scrolling the caret's block beyond the pin cap drops native focus, so Ctrl+Z is inert until a mounted block holds focus.
- Undo fires after the caret's block is windowed out (F2): after an edit whose block scrolls out of the window, a mounted block is focused to route the Ctrl+Z keydown, and undo still reverts the off-window edit and reveals the block. Reverting the focus-a-mounted-block listener leaves the key press inert and the marker in place.

## Nested reveal (Phase 3)

- Reveal a deep off-window nested target: on a giant list, the deeply nested last leaf is unmounted at load; clicking the first item then Ctrl+Shift+End extends the cross-block selection to that leaf, and typing a marker lands it at the end of the source — `revealByPath` scrolled and mounted the off-window item.
- Collapse-to-start lands the caret in the off-window anchor item: on a giant list, Ctrl+Shift+End scrolls the window to the doc-end focus, so the row-0 anchor item is windowed out by collapse time. ArrowLeft collapses the cross-block selection to the start; the collapse must REVEAL and focus item 0 — a typed marker lands on source line 0 (the anchor item), not the focus item. A pre-fix defect gated the canonical container `revealByPath` on a stale ref slot (an item scrolled off-window leaves a detached ref behind), so it skipped mounting item 0, descended into the stale ref, and hung the reveal — stranding the caret at the off-window focus item. The CST item count is also unchanged afterward (the body survives the collapse).

## Table reveal (Phase 4)

- Reveal an off-window cell by scroll: on a giant table, far rows are unmounted at load; scrolling near the bottom windows in a far row (idx well past the initial window), and clicking its cell + typing a marker lands the edit in that now-mounted row and reaches the source.
- Reveal an off-window cell by keyboard extend: Ctrl+Shift+End inside a table cell normalizes the focus to a cell-coordinate endpoint at the table block; the extend reconstructs the deep cell path and reveals it, mounting the off-window last row (the active-endpoint pinned-caret invariant). Revealing scrolls the anchor cell off-window, so the dispatch caret is parked at the revealed cell's start to keep the next keystroke routed to a focused block.
- Collapse a keyboard table selection into the revealed cell: after Ctrl+Shift+End, ArrowRight collapses to the end and reconstructs the deep cell path so the caret lands at the end of the off-window cell (via the cell ref, since the cell-coordinate offset is a linear index, not a char offset); typing a marker lands it in that last row and reaches the source.
- Collapse-to-start lands the caret in the off-window anchor cell: after Ctrl+Shift+End, ArrowLeft collapses the cross-block selection to the start (the row-0 anchor cell, scrolled off-window by the extend). The collapse must REVEAL and focus row 0 — the active cell is row 0 and a typed marker lands in row 0's first cell, not the focus cell. A pre-fix defect gated `revealByPath` on a stale ref slot (a row scrolled off-window leaves a detached ref behind), so it skipped mounting row 0 and the caret stranded in the off-window focus cell. The CST row count is also unchanged afterward (the body survives the collapse).

## Error cases

- No page errors (e.g. `state_unsafe_mutation`) surface during the reveal, scroll, or undo paths.
