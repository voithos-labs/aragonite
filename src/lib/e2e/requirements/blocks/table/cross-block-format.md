# Feature: a format toggle over a range that reaches into a table

A cross-block range decomposes into one span per participating block, and a table
joins by its CELLS. A cell endpoint addresses its table by row-major cell index,
so a range never cuts a cell in half: every covered cell contributes its whole
content, and every covered cell is rewritten. Which cells are covered is the
grid's own question — one endpoint outside the table makes it a run to the
endpoint cell inclusive (after the whole-row snap), both endpoints inside makes it
the rectangle they span, the same cells the overlay paints and Backspace clears.
Direction is still the range's own coverage, and the whole press is ONE undo entry.

## Happy paths

- `Mod+B` over a whole-document range of a paragraph above a table marks the
  paragraph and every cell, and one `Mod+Z` restores the document byte-for-byte
- a drag from the paragraph into a body cell marks that cell's row and every row
  above it, and leaves the rows below untouched: the whole-row snap decides where
  the run stops, so highlight and rewrite agree on the same cell set
- a drag between two cells of one table marks the RECTANGLE they span, leaving the
  cells whose index falls between them but whose column does not alone
- a keyboard `Shift+ArrowDown` out of the last cell, carried on to the document
  end, marks that cell's row and the paragraph below, the pointer path's twin
  through the keymap. The extend alone lands the focus at the paragraph's offset
  0, where its head span is empty and only the cells are marked

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
  shared e2e fixture) — a cell endpoint reaching a char-offset site is exactly the
  shape G1.29 catches
- the document still round-trips after the press: a cell write that escaped wrong
  would reparse as a different grid

## Miss-analysis

- The grid was excluded from `planCrossBlockFormat` by a written-down decision, so
  nothing was silently broken — but no test in either suite ever handed the plan a
  table endpoint, in either coordinate space, so the day the exclusion lifted there
  was no shape to answer against. `cross-block-format-toggle.spec.ts` builds every
  range with `Mod+A` over paragraphs; the table's own specs drive delete, clipboard
  and selection paint over cell ranges but never a rewrite.
- The two readings of an intra-table pair (row-major run vs rectangle) are pinned
  only where a gesture drives them. The unit corpus can assert either and be
  self-consistent; the drag above is what ties the rewrite to what the user sees lit.
