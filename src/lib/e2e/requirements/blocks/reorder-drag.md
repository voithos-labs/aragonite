# Feature: drag-to-reorder

Mouse drag from a block's hover handle moves it among its siblings. A ghost
follows the pointer and a single insertion line marks the drop gap; nothing
reflows mid-drag and the tree changes once, on release.

The ghost is LABELLED, not a text sample: a table's cells run together into
`IngredientAmountWater35 L` and an equation reads as its own source, so those
kinds name themselves (`Table · 13 × 2`, `Equation`, `Code`, `Diagram`,
`Divider`, `Image`) and prose keeps its first words.

A drop focuses nothing. Focusing what was dropped opens whatever a caret opens
there — an equation reveals its source — which a drag never asked for. The
keyboard nudge is the opposite: the caret rides the block it moves.

## Happy paths

- Drag a top-level block down past two siblings: it lands after them.
- Drag a top-level block up to the top: it becomes the first block.
- Drag a list item within its list: it lands at the dropped position; markers stay correct.

## Edge cases

- A block dropped into a slot whose separator was empty (a heading interrupting the paragraph
  above it) arrives separated: the table stays a table under the paragraph, the source reloads
  to the same three blocks.
- Drop outside any valid sibling gap / release without moving: no change.
- Escape or pointercancel during a drag: cancelled, no change.
- Drag toward the viewport edge in a large doc autoscrolls past virtualized blocks so an off-window target comes into reach, and the drop commits an intact move.

## User interactions

- Pointer-down on the handle, move, release (real pointer events) — not a programmatic move.
- Dragging from the handle does not start a text selection in the block body.

## Miss-analysis

- Every reorder fixture separated its blocks with blank lines, so no slot the rotation reseated
  ever carried an empty separator; the one shape that does, a heading interrupting the
  paragraph above it, was never dragged past. Now pinned here for the handle, in
  `reorder-keyboard.md` and `table/shortcuts.md` for the chords, and as a property over
  every kind pair in `test/tree-operations/reorder-lands-whole.property.test.ts`.
