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
- Live mode, a code chip's edge has two caret stops, drawn against the chip's own box rather than
  the range's, which is off by a few pixels there: inside, the bar sits in the chip's padding at
  its last letter (or its first, at the opener); outside, it sits 2px past the chip's border
- A click at the chip's last letter paints inside, and the next letter types inside the chip
- One ArrowRight there moves the bar 2px past the border while the caret stays put, and the next
  letter types past the chip; a second ArrowRight moves the caret past the space
- The opener mirrors it: a click at the first letter paints inside, and ArrowLeft moves the bar 2px
  before the border, where the next letter types in front of the chip
- A click just right of the chip paints outside and types outside; a click in its padding paints
  inside and types inside
- A chip that wraps draws its closing stops against the box on its last line
- Backspace deletes the letter drawn left of the bar, whichever side of the border the bar is on
- Every one of these shows exactly one caret, the bar, and none of the browser's
- The same chip, the caret between two of its letters: the bar draws where the browser paints
- In a table cell, ArrowRight at a chip's end crosses the border and the letter types past it
- For Daniel's try: End on a line ending in a chip lands outside it, and ArrowLeft into a chip from
  the text after it stops past the border first, then inside
  - Miss-analysis: the chip rows asserted the browser's own caret at every edge, so no row asked
    which side of the border a caret there meant, or drew it
