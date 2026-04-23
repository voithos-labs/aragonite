# Block: List — Marker Inside Contenteditable

The list item marker (`- ` / `1. `) renders as an atomic `.md-marker` span inside the first child paragraph's contenteditable, not as a flex-sibling element outside it. This restores the "always-visible styled source" contract and matches heading-marker behavior.

## Happy paths

- Unordered list renders: first child's contenteditable contains a `.md-marker` span with text `- `, attribute `contenteditable="false"`, and the old flex-sibling marker is absent.
- Ordered list renders: first child's contenteditable contains a `.md-marker` span with text `1. ` (and `2. `, `3. `, etc. in successive items).
- Source round-trips after the refactor: `loadContent('- Hello\n')` → `getSource()` returns `- Hello\n`.

## User interactions

- Typing at raw offset 0 (Home key from inside content): inserts at start of content. `- Hello` + Home + `X` → `- XHello`.
- Click in the marker region (leftmost pixels before the `-`): cursor lands at raw offset 0. Typing after the click inserts at start of content.
- Ctrl+A inside first child: selects only the raw content, not the marker. Typing after Ctrl+A replaces content only; marker preserved.
- Backspace at raw offset 0 of first item: U1 unwrap (paragraph lifts out).
- Backspace at raw offset 0 of non-first item: M1 merge into previous item's deepest prose leaf.

## Edge cases

- Empty list item (`- \n`): first child is an empty paragraph; contenteditable renders the ambient marker span and an empty content region. `ensureBr` fallback still adds a `<br>` to keep the block focusable. Typing into it produces `- X\n`, not `- \n  X\n` (parser routes the trailing newline into innerPrefix; the backfilled paragraph subsumes that role).
- Multi-digit ordered marker (`10. `): ambient prefix is 4 chars; cursor math uses `ambientLength=4` correctly.
- First prose child of an ambient-wearing list item has hanging-indent style (`text-indent: -<ambientLength>ch; padding-left: <ambientLength>ch`) so wrapped lines and continuation paragraphs hang under the content rather than under the marker. Non-first children carry no such style. Values track `ambientLength` so they stay correct as the marker widens (e.g. task checkboxes at 0.6.1).
- Nested list: parent's first child gets ambient `- `; nested list's first child gets its own ambient `- `. Independence verified via typed-marker assertion in each.
