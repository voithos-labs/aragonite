# Feature: Selection overlay rendering

## Happy paths

- Cross-block selection renders middle-block overlay on every block between start and end
- Single-block selection uses native rendering, no custom overlay divs
- When selection collapses, all overlay divs are removed

## Edge cases

- Overlay has pointer-events: none so clicks pass through
- A start or end block the range covers only in part paints its selected part out to the block's
  edges, not hugging the text: the start from its point to the right edge plus everything below
  it, the end everything above it plus the left edge up to its point (the rows under One paint per
  block check this for each kind of block)
- A container the range holds whole (blockquote, list) paints one box over everything it renders, its own markers included; its children paint none, so nothing is drawn twice
- A list item the range holds whole paints its own box over its marker and its content, though it renders no block host of its own; a nested sub-list under such an item paints no second box
  - Miss-analysis: every overlay test ran over blocks a block host wraps, so an item, the one container that renders none, was the case no test could reach

- A drag from a paragraph into a closed details' title row paints the details as one box, covering
  the title row end to end, and the title row paints no box of its own. The range takes the
  hidden body too, so the overlay shows what a delete or a cut would take
  - Miss-analysis: the overlay read the raw endpoints and painted only the title characters the
    drag crossed, and every overlay test ran over open blocks, so nothing compared it to the delete

## One paint per block

- A range from a paragraph's first character to the last character of a list's last item paints
  the paragraph one box and the list one box, the same box each block between the ends gets.
  Nothing under the list's box paints, and no two painted rects share a pixel, so the wash never
  shows twice as dark
  - Miss-analysis: every box test put the range's ends strictly outside the boxed blocks, so no
    test asked how an end block the range covers to its last character paints, and nothing
    compared the ends' paint with the paint of the blocks between

- A range whose ends sit mid-text paints the start block from its point to the block's right edge
  and every line below it, and the end block over every line above it and from its left edge to
  its point, so the ends meet the full boxes of the blocks between. That holds for a heading, a
  paragraph, a list item, a quote line and a code block, in source mode and in live mode
  - Miss-analysis: the endpoint rects were only ever checked for being there and for staying inside
    their block, so nothing compared the ends' paint with the boxes of the blocks between

- An end's own line paints its whole line, the gap above and below the text included, not just
  the height of the letters. A one-line quote you start mid-text paints from the start point to
  the right edge over the quote's full height, and nothing under the words before the start point;
  a one-line list item you end mid-text paints from its left edge to the end point the same way,
  and nothing over the words after it. In a wrapped paragraph the strip under a start's line (or
  over an end's line) begins past that line's own gap, so no tint touches the unselected words, in
  source mode and in live mode
  - Miss-analysis: the line-edge rows checked only that the paint reached the block's edges, and
    the unit rows set each line's letters flush with the next, so no test looked at the gap a
    line keeps around its letters, where the strip painted under the unselected words

## Error / degenerate cases

- Block content changes while cross-block selection exists: overlay should reflect new layout via reactivity
