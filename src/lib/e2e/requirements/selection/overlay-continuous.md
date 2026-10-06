# Feature: a cross-block selection paints one region

A range across blocks reads as one selection, the shape a code editor paints: from the start
point to the right edge, everything in between full width, then from the left edge to the end
point. The space between two blocks the range runs through is painted too (a block's padding, the
margin to the next block, the blank lines between them), so no stripe of unpainted page cuts the
region. Above the start's line and below the end's line nothing paints. Driven on `/test/editor`
with a real click and a Shift+click, in source mode and in live mode; each scenario reads the
painted rects' geometry, not pixels.

## Happy paths

- a one-line quote, over two blank lines (which leave an empty paragraph), into the last item of a
  numbered list: the painted region has no hole from the quote's line to the item's line
- a two-line quote into the paragraph after it: no hole across the quote's padding and the margin
- a heading into a code block, whose padding sits above its first line: no hole

## Edge cases

- nothing paints above the start block or below the end block
- a range grown with Shift+ArrowDown after it's painted stays one region: the space between
  blocks follows the blocks' own paint as it changes
- a range from inside a GitHub alert's body into a list item (the demo page's "Punishing Evil"
  section) paints one region, the alert's own padding below its body included (the plugin spec
  `plugins/github-alert-selection-overlay.spec.ts` holds that row)

## Miss-analysis

- Every overlay row checked each block's paint inside its own box, so nothing looked at the space
  between two boxes, where the page showed through as stripes of uneven height
