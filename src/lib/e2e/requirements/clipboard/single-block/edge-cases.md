# Feature: Single-block clipboard — edge cases

## Edge cases

- Ctrl+X then undo: text restored
- Paste at end of block: appends
- Paste at start of block: prepends
- Ctrl+C does not modify source
- Ctrl+X on empty selection: no-op

## Error / degenerate cases

- Paste of single-line content stays inline, block count unchanged
