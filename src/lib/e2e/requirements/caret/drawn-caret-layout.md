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
- The clipped caret wheeled back into view: the bar draws again, where the browser paints
  - Miss-analysis: the clip rows only scrolled the caret out; the scroll repaint ran only while a
    bar showed, so nothing brought it back until the caret moved
- A caret at a cell's end, a table of 18 columns wheeled sideways until that cell leaves its box: no
  bar shows outside the table
  - Miss-analysis: the clip rows scrolled only a code block, whose scroller is the editable itself,
    so the walk from the editable up to the block never had to look past it
- A table row whose first cell the caret visited and left keeps hearing that cell grow (a font
  size change with no edit), so the row's height still reaches the table's windowing
  - Miss-analysis: the shared size watch kept one listener per element, and the drawn caret watches
    the cell a row also watches; no row put two watchers on one element
- Live mode, the caret at a code chip's edge (before it, inside at either end, past it): the
  browser's own caret shows, in every engine, since each paints it a few pixels off the range's box
  there, on its own side of the chip's padding
- The same chip, the caret between two of its letters: the bar draws where the browser paints
- A letter typed past the chip and deleted again: the browser's own caret shows
  - Miss-analysis: the chip row compared Chromium's bar with the range's box, the very box that's
    off at a chip's edge, so a bar 4px from Chromium's own caret passed
