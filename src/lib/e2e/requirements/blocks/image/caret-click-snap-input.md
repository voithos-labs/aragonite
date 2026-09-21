# Feature: Typing and paste at the click-snap caret

After click-snap places the caret at a widget boundary, printable input has to land at the snap target. Chromium quietly drops printable-key insertions between `contenteditable=false` neighbors, so the editor's keydown branch routes the character through the CST instead of relying on the browser's default.

## Happy paths

- After click-snap places the caret at an image's trailing edge, typing a printable character inserts it into the source immediately after the image
- Typing after a click-snap continues where the edit left off: `pendingCursorOffset` restores the caret after the CST update, so the second character lands right beside the first, with no jump back to the start of the paragraph
- Shift+Enter at image.end inserts the hard break immediately after the image source, not at offset 0 of the inner paragraph
- Shift+Enter still lands the break after the image source when the browser has dropped the caret between the click and the keystroke: the snap target the click set is the offset the keydown reads
  - Miss-analysis: the specs that drop the range drop it inside the same `evaluate` that dispatches the event, so the editor's own `selectionchange` handler had never run before a key was pressed, and a handler that threw the snap target away on `rangeCount === 0` passed every one of them
- Paste in click-snap state lands at the snap target offset, not at offset 0

## Edge cases

- The fallback does not fire when the live caret is in a real text node next to a widget (the wrap boundary after an inline image, for one): Chromium's own typing handles those positions, and stepping in would lose the live caret and make it jump
- It does fire even when Chromium keeps the live caret at an element-level position past the widget (a real-browser shape that Playwright collapses to null): the test is "the caret sits in a real text node", not "the live caret is null"
