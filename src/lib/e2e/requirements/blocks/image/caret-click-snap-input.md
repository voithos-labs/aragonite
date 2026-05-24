# Feature: Typing and paste at the click-snap caret

After click-snap places the caret at a widget boundary, printable input has to land at the snap target. Chromium silently drops printable-key insertions between `contenteditable=false` neighbors, so the editor's keydown branch routes the character through the CST instead of relying on the browser default.

## Happy paths

- After click-snap places the caret at an image's trailing edge, typing a printable character inserts it into the source immediately after the image
- Subsequent typing after a click-snap continues at the post-edit position — `pendingCursorOffset` restores the caret after the CST update, so the second character lands contiguously next to the first (no caret teleport to the start of the paragraph)
- Shift+Enter at image.end inserts the hard break immediately after the image source, not at offset 0 of the inner paragraph
- Paste in click-snap state lands at the snap target offset, not at offset 0

## Edge cases

- The snap-fallback intercept does NOT fire when the live caret is in a real text node next to a widget (e.g., the wrap boundary after an inline image) — Chromium's native typing handles those positions, intercepting would lose the live caret state and cause teleport bugs
- The intercept fires even when Chromium preserves the live caret at an element-level position past the widget (real-browser shape that Playwright collapses to null) — gating is on "caret sits in a real text node", not on "live caret is null"
