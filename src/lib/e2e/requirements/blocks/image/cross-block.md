# Feature: Cross-block selection through image widgets

## Happy paths

- Shift+ArrowRight at left boundary extends selection across the entire widget atomically
- Cross-block delete that includes a widget removes the entire widget source bytes
- Undo restores the widget after cross-block delete

## User interactions

- pointer drag that STARTS on an image widget and moves into the next block enters cross-block mode: the widget's pointerdown no longer stops propagation, so the block's cross-block machinery sees the gesture
