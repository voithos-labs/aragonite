# Feature: Pointer-driven cross-block selection

## Happy paths

- Click-drag from block A into block B: enters cross-block mode with anchor at click point
- Click-drag across three paragraphs: middle block shows full-block overlay, endpoint blocks show partial overlays
- Shift+click from one block into another: enters cross-block mode

## Edge cases

- Click-drag that stays inside one block: no cross-block mode entered
- Click without shift while cross-block active: collapses selection
- Click collapse restores native caret in the clicked block: typing inserts at click point

- A block with no positions inside it (a rendered equation, a diagram, a rule) joins a drag's
  range as a unit once the pointer has crossed its centre line coming from the anchor's side.
  A sweep that only touched its edge has not asked for it, and the last focus stands until the
  pointer commits; the rule is symmetric for drags coming down onto it and up onto it.
- A drag that STARTS on such a block (on the equation or beside it in its box) selects that block
  alone as soon as the pointer moves, painted as a whole unit; leaving the block grows the range
  from it, and coming back takes it whole again. Focus parks on the editor root when the drag
  ends, so copy yields the block's source and Backspace removes it.

## User interactions

- Drag across a blockquote boundary: cross-container selection works

## Error / degenerate cases

- pointerup during drag in the same block as pointerdown: selection stays single-block (native)
- Drag to a non-editable block (thematic break): thematic break gets middle-block overlay, not an endpoint
- Drag from block A out to block C then back into block A before release: cross-block collapses, no overlay over block B remains
