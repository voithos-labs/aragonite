# Block: List — Caret Placement and Typing Around the Marker

The marker is `contenteditable="false"`; raw offset 0 maps to the DOM offset just past the marker. Multi-digit ordered markers exercise the same translation.

## User interactions

- Typing at raw offset 0 (Home key from inside content): inserts at start of content. `- Hello` + Home + `X` → `- XHello`.
- Click in the marker region (leftmost pixels before the `-`): cursor lands at raw offset 0. Typing after the click inserts at start of content.
- Ctrl+A inside first child: selects only the raw content, not the marker. Typing after Ctrl+A replaces content only; marker preserved.

## Edge cases

- Multi-digit ordered marker (`10. `): ambient prefix is 4 chars; cursor math uses `ambientLength=4` correctly.
