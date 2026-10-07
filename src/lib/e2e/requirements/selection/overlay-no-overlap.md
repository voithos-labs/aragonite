# Feature: No two painted highlight rects overlap

The selection wash is translucent, so anywhere two painted rects share pixels the highlight
shows up darker there. While a range across blocks is on, no two painted rects share more than a
hairline (half a pixel either way). "Painted" means every rect the overlay draws, any element or
`::after` filled with the wash, and the browser's own selection wherever its `::selection` isn't
transparent. Each case runs at a width narrow enough that the long paragraphs wrap, in source mode
and in live mode, and reads the rects off the page rather than off a screenshot.

## Happy paths

- A paragraph into a list item, both ends mid-text: the start line, the strip under it, the item
  boxes and the end item's lines only meet at their edges. The same for a heading into a wrapped
  paragraph, a wrapped paragraph into a list item, a list item into a quote line and a quote line
  into a code block: each kind as a start and as an end
- A range across a rule the range holds whole: the rule's box and the two ends' strips meet only
  at their edges

## Edge cases

- A range ending in a table cell: the start's strips and the table's cell rects don't overlap. A
  backward range, from a list item up into a heading, paints the same as forward, nothing overlaps
- A drag inside a rule holds it whole (one box); Shift+ArrowDown and a Shift+click then grow the
  range into the paragraph below, and the rule's box and that paragraph's lines don't overlap.
  Wrapped rows set with a line-height under the glyphs' own height, so each row's text box
  reaches into the next: the start line and the strip under it still don't overlap

## Error cases

- None of the cases above finds the browser drawing its own selection under the overlay: the
  native selection is collapsed while the overlay is on, and its `::selection` is transparent
