# Block: List, Cross-Block Selection Overlay Edge

The painted selection overlay must start at the list item's content edge (raw offset 0), not at the marker edge. `measurePartialRects(0, n)` used to set the DOM start to 0 and bleed into the `contenteditable="false"` marker span.

## Edge cases

- Cross-block selection ending in a list item: the painted overlay starts at the list item's content edge (raw offset 0), not the marker edge. The fix translates raw offset 0 → DOM offset = ambientLength unconditionally.
