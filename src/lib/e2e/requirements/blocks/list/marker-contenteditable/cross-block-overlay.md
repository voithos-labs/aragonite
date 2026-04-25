# Block: List — Cross-Block Selection Overlay Edge

The painted selection-overlay must start at the list item's content edge (raw offset 0), not the marker edge. Pre-fix, `measurePartialRects(0, n)` short-circuited DOM start to 0 and bled into the `contenteditable="false"` ambient span.

## Edge cases

- Cross-block selection ending in a list item: the painted overlay starts at the list item's content edge (raw offset 0), not the marker edge. The fix translates raw offset 0 → DOM offset = ambientLength unconditionally.
