# Block: List, Empty Item Rendering

An empty list item still renders the leading marker plus a `<br>` fallback to keep the block focusable; typing produces `- X\n`, not `- \n  X\n`.

## Edge cases

- Empty list item (`- \n`): first child is an empty paragraph; contenteditable renders the marker span and an empty content region. The `ensureBr` fallback still adds a `<br>` to keep the block focusable. Typing into it produces `- X\n`, not `- \n  X\n` (the parser routes the trailing newline into innerPrefix; the backfilled paragraph takes that role over).
