# Feature: Click-to-edge snap landing offset

The browser's own click cannot put a caret past a `contenteditable=false` widget. The snap works the offset out by mapping the click position to the nearest widget edge.

## Happy paths

- Clicking in the empty area to the right of an image-only paragraph lands the cursor at the image's end offset
- Clicking in the empty area to the left of an image-only paragraph lands the cursor at the image's start offset

## Edge cases

- Click-snap runs even when the browser left the caret at a useless element-level offset (div offset 0 between two contenteditable=false widgets, for one): only a click that landed in a real text node counts as the "valid in-text click" the snap steps aside for
