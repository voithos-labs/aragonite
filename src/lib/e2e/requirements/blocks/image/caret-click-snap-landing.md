# Feature: Click-to-edge snap landing offset

Browser-native click can't anchor a caret past a `contenteditable=false` widget. The snap mechanism recovers the offset by mapping the click position to the nearest widget edge.

## Happy paths

- Clicking in the empty area to the right of an image-only paragraph lands the cursor at the image's end offset
- Clicking in the empty area to the left of an image-only paragraph lands the cursor at the image's start offset

## Edge cases

- Click-snap runs even when the browser parked the caret at a degenerate element-level offset (e.g., div offset 0 between two contenteditable=false islands) — only a click that landed in a real text node is a "valid in-text click" the snap respects
