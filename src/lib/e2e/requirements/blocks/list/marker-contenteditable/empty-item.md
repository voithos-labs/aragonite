# Block: List — Empty Item Rendering

An empty list item still renders the ambient marker plus a `<br>` fallback to keep the block focusable; typing produces `- X\n`, not `- \n  X\n`.

## Edge cases

- Empty list item (`- \n`): first child is an empty paragraph; contenteditable renders the ambient marker span and an empty content region. `ensureBr` fallback still adds a `<br>` to keep the block focusable. Typing into it produces `- X\n`, not `- \n  X\n` (parser routes the trailing newline into innerPrefix; the backfilled paragraph subsumes that role).
