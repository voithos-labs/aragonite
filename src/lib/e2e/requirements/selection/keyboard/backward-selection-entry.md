# Feature: Keyboard cross-block entry from a backward selection (E-F2)

Entering cross-block mode while a backward native selection is active (anchor after focus) must capture the true anchor, not the moving focus at the range start.

## User interactions

- Caret at offset N, Shift+ArrowLeft ×N (backward selection over the leading text), then one more Shift+ArrowLeft past the block edge: the cross-block anchor is the block-relative anchor (offset N), not the focus at 0
- Backspace after such an entry deletes the range the user highlighted, not a range shifted to the wrong anchor
