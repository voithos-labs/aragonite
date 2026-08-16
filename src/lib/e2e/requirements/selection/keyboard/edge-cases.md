# Feature: Keyboard cross-block selection — edge cases

Boundary, no-op, and degenerate cases for cross-block selection.

## Edge cases

- Shift+ArrowDown at last block: no-op, cross-block stays inactive
- Shift+ArrowDown out of a table that IS the last block: no-op, and the cell stays editable —
  the next Backspace deletes one character rather than clearing the cell
- Shift+ArrowUp at first block: no-op, cross-block stays inactive
- Ctrl+A doubling counter resets on non-Ctrl+A keystroke: pressing Ctrl+A after typing starts fresh
- Shift+ArrowDown from paragraph into blockquote: activates cross-block, focus lands inside blockquote

## Error / degenerate cases

- Empty document (single empty paragraph): double Ctrl+A does not crash, source unchanged
- Thematic break between endpoint blocks: gets whole-block overlay highlight, no crash

## Miss-analysis (Sel-F1)

The declining last-block gesture was pinned with a PARAGRAPH as the last block, where the
entry path never mints a pair at all. The table sibling mints one first and then hears the
extend decline, and no scenario named it. The pin also asserted through `[data-cross-block]`,
which the phantom state attaches — the oracle and the defect were the same bit.
