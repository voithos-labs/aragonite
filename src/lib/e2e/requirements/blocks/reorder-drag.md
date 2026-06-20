# Feature: drag-to-reorder

Mouse drag from a block's hover handle moves it among its siblings. A ghost
follows the pointer and a single insertion line marks the drop gap; nothing
reflows mid-drag and the tree changes once, on release.

## Happy paths

- Drag a top-level block down past two siblings: it lands after them.
- Drag a top-level block up to the top: it becomes the first block.
- Drag a list item within its list: it lands at the dropped position; markers stay correct.

## Edge cases

- Drop outside any valid sibling gap / release without moving: no change.
- Escape or pointercancel during a drag: cancelled, no change.
- Drag near the viewport edge autoscrolls so off-screen siblings come into reach.

## User interactions

- Pointer-down on the handle, move, release (real pointer events) — not a programmatic move.
- Dragging from the handle does not start a text selection in the block body.
