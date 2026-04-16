# Feature: Pointer-driven cross-block selection

## Happy paths
- Click-drag from block A into block B: enters cross-block mode with anchor at click point
- Click-drag across three paragraphs: middle block shows full-block overlay, endpoint blocks show partial overlays
- Shift+click from one block into another: enters cross-block mode

## Edge cases
- Click-drag that stays inside one block: no cross-block mode entered
- Click without shift while cross-block active: collapses selection

## User interactions
- Drag across a blockquote boundary: cross-container selection works
