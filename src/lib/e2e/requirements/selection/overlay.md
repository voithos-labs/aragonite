# Feature: Selection overlay rendering

## Happy paths

- Cross-block selection renders middle-block overlay on every block between start and end
- Single-block selection uses native rendering, no custom overlay divs
- When selection collapses, all overlay divs are removed

## Edge cases

- Overlay has pointer-events: none so clicks pass through
- An end block the range covers only in part paints rects over its selected text, on the start block and the end block both
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

## Error / degenerate cases

- Block content changes while cross-block selection exists: overlay should reflect new layout via reactivity
