# Feature: Single-block clipboard operations

## Happy paths
- Select text via Shift+Arrow then Ctrl+C, move cursor, Ctrl+V: text duplicates
- Select text then Ctrl+X: text removed and on clipboard
- Select text then Ctrl+V: replaces selection with clipboard content
- Select text then type characters: replaces selection with typed text

## Edge cases
- Ctrl+X then undo: text restored
- Paste at end of block: appends
- Paste at start of block: prepends
- Ctrl+C does not modify source
- Ctrl+X on empty selection: no-op

## User interactions
- Shift+Arrow select, Ctrl+X, move to another block, Ctrl+V: text moves
- Ctrl+A selects block content natively
- Multi-character typeText after select-all replaces content

## Error / degenerate cases
- Paste of multi-block markdown at single caret: produces multiple blocks
- Paste of single-line content stays inline, block count unchanged
