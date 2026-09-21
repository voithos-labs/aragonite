# Block: List, Marker Rendering

The list-item marker (`- ` / `1. `) renders as an atomic `.md-marker` span inside the first child paragraph's contenteditable, not as a flex-sibling element outside it. Each nested level gets its own leading marker.

## Happy paths

- Unordered list renders: first child's contenteditable contains a `.md-marker` span with text `- `, attribute `contenteditable="false"`, and the old flex-sibling marker is absent.
- Ordered list renders: first child's contenteditable contains a `.md-marker` span with text `1. ` (and `2. `, `3. `, etc. in successive items).

## Edge cases

- Nested list: the parent's first child gets the leading `- `; the nested list's first child gets its own.
