# The drawn caret

On a fine pointer the editor draws the caret itself, as one bar per editor, and hides the browser's
caret only on the editable it draws for. The browser's selection stays where it is, so typing, IME
and screen readers read the real thing. Exactly one caret shows at any moment: the drawn bar, the
browser's own, or the snap caret beside an inline widget.

## Happy paths

- A click in a paragraph: one drawn caret shows, on the browser's caret position, and the browser's own is hidden
- Typing letter by letter: after every key one drawn caret shows, on the browser's caret position
- The drawn caret sits on the browser's caret position (within a pixel) at each of these places:
  - the start of a line
  - the end of a line
  - an empty block
  - a heading
  - a list item
  - a quote
  - a table cell
  - a code block
  - text right after an inline widget
  - the line a Shift+Enter at a block's end opens
  - a plugin's editable leaf

## Edge cases

- Focus leaves the editor for the page: no caret shows, and the drawn one comes back on a click into the text
- The window loses focus: no caret shows; it regains focus: the drawn caret shows again
- A range in one block (Shift+ArrowLeft): no caret shows; collapsing it shows the drawn one again
- A cross-block range (Shift+ArrowDown into the next block): no caret shows
- Beside an image the snap caret is the one caret, and the drawn one draws nothing
- An input the editor doesn't draw for (the find bar) keeps the browser's caret, and the drawn one draws nothing
- During an IME composition the browser's caret shows; after the commit, the drawn one
- Reduced motion: the drawn caret doesn't blink
- Forced colors: the browser's caret shows, since forced colors keep it visible whatever the editor sets, and the drawn one draws nothing
- A coarse pointer keeps the browser's caret
- The `caret` prop: `native` never draws, `drawn` draws, and switching between them live swaps the caret in place
- The bar is hidden from assistive tech, and the focused editable and its selection are what they would be without it
