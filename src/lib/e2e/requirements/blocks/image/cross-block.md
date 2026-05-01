# Feature: Cross-block selection through image widgets

## Happy paths

- Shift+ArrowRight at left boundary extends selection across the entire widget atomically
- Cross-block delete that includes a widget removes the entire widget source bytes
- Undo restores the widget after cross-block delete
