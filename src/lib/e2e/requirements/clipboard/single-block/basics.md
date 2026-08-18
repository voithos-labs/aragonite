# Feature: Single-block clipboard — basics

## Happy paths

- Select text via Shift+Arrow then Ctrl+C, paste at end of block: appends the copied text
- Paste at start of block: prepends
- Select text then Ctrl+V: replaces selection with clipboard content
- Select text then type characters: replaces selection with typed text

## Edge cases

- Ctrl+X then undo: text restored
- Ctrl+C does not modify source
- Ctrl+X on empty selection: no-op

## User interactions

- Shift+Arrow select, Ctrl+X, move to another block, Ctrl+V: text moves (the cut removes the selected text)
- Ctrl+A selects block content natively; multi-character typeText after select-all replaces content

## Error / degenerate cases

- Paste of single-line content stays inline, block count unchanged
