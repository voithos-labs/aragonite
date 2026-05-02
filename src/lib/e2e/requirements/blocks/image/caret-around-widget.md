# Feature: Caret traversal around image widgets

## Vertical (ArrowUp / ArrowDown)

- ArrowUp from the start of the paragraph below a standalone image lands at the previous text-bearing paragraph (skips the image-only paragraph) in one press
- ArrowDown from the end of the paragraph above a standalone image lands at the next text-bearing paragraph (skips the image-only paragraph) in one press
- ArrowUp from a list item paragraph below a list-item that contains only an image lands above the entire list in one press (vertical-skip cascades through the container)
- ArrowDown from a paragraph above a list whose first item is image-only lands in the next text-bearing list item (transparent items are skipped on container entry)
- ArrowUp from a paragraph below a list whose last item is image-only lands in the preceding text-bearing list item (transparent items are skipped on container entry)
- For an inline (mid-paragraph) image, ArrowUp from the line after the image lands at the line before the image — native browser handles this correctly because the surrounding paragraph has text positions

## Horizontal (ArrowLeft / ArrowRight)

- ArrowLeft from the start of a paragraph below a standalone image: press 1 selects the widget, press 2 places the caret at the end of the paragraph above the image
- ArrowRight from the end of a paragraph above a standalone image: press 1 selects the widget, press 2 places the caret at the start of the paragraph below the image
- For an inline image (text both before and after in same paragraph), ArrowLeft from after-image: press 1 selects the widget, press 2 places the caret immediately before the image (end of preceding text)
- For an inline image, ArrowRight from before-image: press 1 selects the widget, press 2 places the caret immediately after the image (start of following text)

## Edge cases

- Caret never lands at a visually-invisible position inside an image widget (the hidden source-bytes span must not act as a caret target)
- Cross-block ArrowLeft/Right into a paragraph that ends/starts with an image selects the widget directly rather than placing an invisible caret at the widget's edge
- A paragraph containing only image widget(s) is treated as vertically transparent — ArrowUp/Down passes through without stopping

## Click-to-edge snap (Notion-style)

- Clicking in the empty area to the right of an image-only paragraph lands the cursor at the image's end offset (browser native click can't anchor a caret past a contenteditable=false widget; the snap recovers it)
- Clicking in the empty area to the left of an image-only paragraph lands the cursor at the image's start offset
- Click-snap runs even when the browser parked the caret at a degenerate element-level offset (e.g., div offset 0 between two contenteditable=false islands) — only a click that landed in a real text node is a "valid in-text click" the snap respects
- After click-snap places the caret at an image's trailing edge, typing a printable character inserts it into the source immediately after the image (the snap-fallback keydown intercept routes the character through the CST when Chromium has dropped the live caret)
- Subsequent typing after a click-snap continues at the post-edit position — `pendingCursorOffset` restores the caret after the CST update, so the second character lands contiguously next to the first (no caret teleport to the start of the paragraph)
- The snap-fallback intercept does NOT fire when the live caret is in a real text node next to a widget (e.g., the wrap boundary after an inline image) — Chromium's native typing handles those positions, intercepting would lose the live caret state and cause teleport bugs

## Synthetic caret on snap target

- A click-snap that lands the cursor at a contenteditable=false-adjacent position renders a blinking synthetic caret on the matching edge of the widget (`md-snap-after` / `md-snap-before` class), so the user has visual confirmation of where typing will go even when Chromium drops the live caret
- The synthetic caret clears as soon as the user types (intercept consumes the snap target) or clicks elsewhere (next snap call resets the offset)
- Inline images surrounded by text don't get the synthetic caret — the live caret in the adjacent text node is already visible, the snap doesn't run there
