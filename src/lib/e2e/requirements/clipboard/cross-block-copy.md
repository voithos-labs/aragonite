# Feature: cross-block clipboard, copy

## Happy paths

- Ctrl+C with cross-block selection copies the correct markdown text to clipboard.
- Select across two paragraphs via Shift+ArrowDown, Ctrl+C, collapse, paste: duplicates text.

## Edge cases

- Ctrl+C preserves the selection (no collapse, no mutation).
- In live mode, a mouse's range across blocks that starts inside a bold run copies the run closed at its edge, and the end block's italic run opened at its edge, as a cut there would take them.
- Blank lines between blocks survive copy + paste: selecting across two paragraphs separated by a blank line and pasting reproduces the blank-line separator (not a soft break merging them into one paragraph).
- Ctrl+Shift+End selection of every block then Ctrl+C and paste duplicates every copied block at the new caret.
