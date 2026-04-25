# Feature: Keyboard cross-block selection — edge cases

Boundary, no-op, and degenerate cases for cross-block selection.

## Edge cases

- Shift+ArrowDown at last block: no-op, cross-block stays inactive
- Shift+ArrowUp at first block: no-op, cross-block stays inactive
- Ctrl+A doubling counter resets on non-Ctrl+A keystroke: pressing Ctrl+A after typing starts fresh
- Shift+ArrowDown from paragraph into blockquote: activates cross-block, focus lands inside blockquote

## Error / degenerate cases

- Empty document (single empty paragraph): double Ctrl+A does not crash, source unchanged
- Thematic break between endpoint blocks: gets whole-block overlay highlight, no crash
