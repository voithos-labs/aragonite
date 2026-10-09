# The drawn caret

On a fine pointer the editor draws the caret itself, as one bar per editor, and hides the browser's
caret only on the editable it draws for. The same bar draws where the browser can't on any pointer:
beside an inline widget and across a gap between blocks. The browser's selection stays where it is,
so typing, IME and screen readers read the real thing. Exactly one caret shows at any moment: the
drawn bar or the browser's own.

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
- Beside an image the bar draws at the image's edge, and it's the one caret
- Typing mid-word writes nothing on the editable: no class, and the attribute that hides the browser's caret only when it moves to another editable
  - Miss-analysis: no test watched the editable's attributes during typing, so a class removed on every key and the hiding attribute set again on every paint went unseen
- An input the editor doesn't draw for (the find bar) keeps the browser's caret, and the drawn one draws nothing
- During an IME composition the browser's caret shows; after the commit, the drawn one
- Reduced motion: the drawn caret doesn't blink, after any number of moves
  - Miss-analysis: the row read the bar once, after one paint, and each move switches between two keyframe rules, so the second one, which out-ranked the reduced-motion rule, was never read
- Reduced motion: the bar beside a widget and across a gap doesn't blink either
- Forced colors: the browser's caret shows, since forced colors keep it visible whatever the editor sets, and the drawn one draws nothing
- Forced colors beside a text-height widget and at a gap: exactly one caret, the browser's, found blinking in a screenshot. Beside an image-only line the browser paints none and the editor draws none either, so there's no caret there under forced colors (the same before the bar took over)
- A coarse pointer keeps the browser's caret
- The `caret` prop: `native` never draws, `drawn` draws, and switching between them live swaps the caret in place
- The bar is hidden from assistive tech, and the focused editable and its selection are what they would be without it
