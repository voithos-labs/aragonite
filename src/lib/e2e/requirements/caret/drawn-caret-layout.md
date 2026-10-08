# The drawn caret against the layout around it

The bar lives in the block it draws for, outside any scroller inside that block, and watches its
editable's size through the editor's one size observer. These rows hold the bar to what the
browser's own caret would do there, and the observer to every block that shares it.

## Edge cases

- A caret in a long code line, the code block wheeled sideways past it: no bar shows outside the
  block's box, where the browser's own caret is clipped too
- The same caret at the line's end, the block wheeled back to its start: no bar outside the box
  - Miss-analysis: no row scrolled an inner scroller with the caret parked, though the drawn caret
    listens for exactly that scroll; the repaint moved the bar, and nothing clipped it
- A table row whose first cell the caret visited and left keeps hearing that cell grow (a font
  size change with no edit), so the row's height still reaches the table's windowing
  - Miss-analysis: the shared size watch kept one listener per element, and the drawn caret watches
    the cell a row also watches; no row put two watchers on one element
- Live mode, the caret at a code chip's edge (inside at its end, and past it): WebKit keeps its own
  caret, since it paints it a few pixels off the range's box there; Chromium draws on the range
