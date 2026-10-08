# Feature: drag-to-reorder

Mouse drag from a block's hover handle moves it among its siblings. A ghost
follows the pointer and a single insertion line marks the gap it would drop
into; nothing reflows mid-drag and the tree changes once, on release.

The ghost carries a label rather than a sample of the text: a table's cells
run together into `IngredientAmountWater35 L` and an equation reads as its own
source, so those kinds name themselves (`Table · 13 × 2`, `Equation`, `Code`,
`Diagram`, `Divider`, `Details`, `Image`) and everything else keeps its first words. A kind
names itself by declaring a `dragLabel`; a table goes by its shape.

A drop focuses nothing. Focusing what was dropped would open whatever a caret
opens there, such as an equation showing its source, which a drag never asked
for. The keyboard move is the opposite: the caret travels with the block.

## Happy paths

- Drag a top-level block down past two siblings: it lands after them.
- Drag a top-level block up to the top: it becomes the first block.
- Drag a list item within its list: it lands at the dropped position; markers stay correct.

## Edge cases

- A drag inside a quote marks the whole quote as its scope, bar and padding included, the way a
  drag inside a list marks the list.
- Drop outside any valid sibling gap / release without moving: no change.
- Escape or pointercancel during a drag: cancelled, no change.
- Dragging toward the viewport edge in a large document autoscrolls past the blocks windowing has not mounted, so a target off screen comes into reach and the drop still moves the block whole.

## User interactions

- Pointer-down on the handle, move, release, with real pointer events rather than a programmatic move.
- Dragging from the handle does not start a text selection in the block body.

## Miss-analysis

- Every reorder fixture separated its blocks with blank lines, so no gap a move landed in ever
  lacked a blank-line separator; the one shape that does, a heading interrupting the paragraph
  above it, was never dragged past. A drop there is pinned in
  `test/editor-actions/reorder-seam-undo.test.ts` (a table dropped flush under a paragraph stays a
  table), and every move from one position to another as a property over every kind pair in
  `test/tree-operations/reorder-lands-whole.property.test.ts`.
