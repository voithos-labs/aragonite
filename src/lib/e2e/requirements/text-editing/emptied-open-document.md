# Feature: A file with no final line break, emptied

A file whose last line has no line ending keeps that through being emptied. Delete everything and the next letter stands alone, with no line break after it, and no dev check fires: an empty document has no last line, so nothing was lost.

Each row starts from `lead`, a blank line, a two-item list, a blank line and `tail` with no final break, with everything selected (Ctrl+A twice). Each runs in source and live mode, with LF and with CRLF line endings.

## Edge cases

- Backspace, then `x`: the source is empty, then `x` (regression: the last-line check read the emptied document as ending in a line break and warned that the typed line lost it; miss-analysis: every row that typed into an emptied document started from one that ended in a line break, and the property driver that drew an open one closed each typed line by hand)
- `x` typed over the selection, with no Backspace between: `x`
- A cut, then a paste: the source is empty, then every line is back and no check fires (which line endings the paste writes, and whether the last line gets one, is #819's)
- Backspace, `x`, an undo, then `y`: `x`, empty, then `y`
