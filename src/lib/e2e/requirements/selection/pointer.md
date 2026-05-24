# Feature: Pointer-driven cross-block selection

## Happy paths

- Click-drag from block A into block B: enters cross-block mode with anchor at click point
- Click-drag across three paragraphs: middle block shows full-block overlay, endpoint blocks show partial overlays
- Shift+click from one block into another: enters cross-block mode

## Edge cases

- Click-drag that stays inside one block: no cross-block mode entered
- Click without shift while cross-block active: collapses selection
- Click collapse restores native caret in the clicked block: typing inserts at click point

## User interactions

- Drag across a blockquote boundary: cross-container selection works

## Error / degenerate cases

- pointerup during drag in the same block as pointerdown: selection stays single-block (native)
- Drag to a non-editable block (thematic break): thematic break gets middle-block overlay, not an endpoint
- Drag from block A out to block C then back into block A before release: cross-block collapses, no overlay over block B remains
