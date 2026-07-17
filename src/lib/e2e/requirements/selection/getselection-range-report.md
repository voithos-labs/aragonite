# Feature: getSelection() reports within-block ranges (Task 4)

`getSelection()` (and the `selectionChange` payload) must report a single-block range with distinct anchor/focus raw offsets, so a consumer can obtain `(start, end)` for the common selection shape instead of a collapsed point.

## User interactions

- Forward within-block selection (Shift+ArrowRight ×N from offset 0): anchor offset 0, focus offset N, cross-block inactive
- Backward within-block selection (Shift+ArrowLeft ×N from offset N): anchor offset N, focus offset 0
- Collapsed caret: anchor === focus at the caret offset
