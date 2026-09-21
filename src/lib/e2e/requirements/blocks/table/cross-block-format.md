# Feature: a format toggle over a range that reaches into a table

A cross-block range breaks down into one span per block it touches, and a table
joins by its cells. A cell endpoint addresses its table by row-major cell index,
so a range never cuts a cell in half: every covered cell contributes its whole
content, and every covered cell is rewritten. Which cells are covered is the
grid's own question: one endpoint outside the table makes it a run up to and
including the endpoint cell (after the whole-row snap), both endpoints inside makes
it the rectangle they span, the same cells the overlay paints and Backspace clears.
Direction is still the range's own coverage, and the whole press is one undo entry.

## Happy paths

- `Mod+B` over a whole-document range of a paragraph above a table marks the
  paragraph and every cell, and one `Mod+Z` restores the document byte-for-byte
- a drag from the paragraph into a body cell marks that cell's row and every row
  above it, and leaves the rows below untouched: the whole-row snap decides where
  the run stops, so highlight and rewrite agree on the same cell set
- a drag between two cells of one table marks the rectangle they span, leaving the
  cells whose index falls between them but whose column does not alone
- a keyboard `Shift+ArrowDown` out of the last cell, carried on to the document
  end, marks that cell's row and the paragraph below, which is the pointer path's
  counterpart through the keymap. The extend alone lands the focus at the paragraph's
  offset 0, where its head span is empty and only the cells are marked

## Edge cases

- an empty cell inside the range is neither written nor counted: markdown cannot
  open a run against nothing, so the covered cells still decide the direction and
  the blank cell keeps its bytes
- a cell holding an escaped pipe survives the toggle as one cell: the write goes
  back through the cell's own escaping and the row re-emits its delimiters
- a second press over the same range unwraps every cell it wrapped, so the toggle
  is reversible through the grid and not only into it

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the
  shared e2e fixture): a cell endpoint reaching a place that expects a character
  offset is exactly the shape G1.29 catches
- the whole-document press and the escaped-pipe press each leave a document that
  still round-trips: a cell write that escaped wrong would reparse as a different
  grid, and those two are the presses whose bytes could do it

## Miss-analysis

- The grid was excluded from `planCrossBlockFormat` by a written-down decision, so
  nothing was quietly broken, but no test in either suite ever handed the plan a
  table endpoint, in either coordinate space, so the day the exclusion lifted there
  was no shape to answer against. `cross-block-format-toggle.spec.ts` builds every
  range with `Mod+A` over paragraphs; the table's own specs drive delete, clipboard
  and selection paint over cell ranges but never a rewrite.
- The two readings of an intra-table pair (a row-major run or a rectangle) are pinned
  only where a gesture drives them. The unit corpus can assert either and stay
  self-consistent; the drag above is what ties the rewrite to what the user sees lit.
- The same gap sat one layer lower: the code plans from the endpoints after the
  whole-row snap, while every unit case built its own pair and called the plan directly,
  so nothing tested that edge. `test/selection/cross-block/format-snapped-endpoints.test.ts`
  now drives a mid-row cell endpoint through the chord and pins the snapped cell set.
