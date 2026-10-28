# Feature: one block per point, whichever pointer gesture asks

A drag, a drag that starts in a table cell, a drag that starts in the editor's margin, a click
run and a drop all turn a viewport point into a block. A point off every block (the margin, a
container's own gutter) goes to the nearest block, clamped into its box and handed down a
container to the child level with it. Every gesture runs at the same points here, so a gesture
that stops asking the shared lookup shows up as the odd one out.

Unit rows hold what real layout can't stage cheaply: a point below a windowed-out tail names no
block for a press (the margin drag's start, a click run), while a drag follows the last mounted
block (`test/selection/nearest-block.test.ts`, `place-caret-at-point.test.ts`).

## Happy paths

- a drag from a paragraph's text into a quote's gutter: the range's focus is the quoted
  paragraph
- a drag from a table cell into a quote's gutter: the focus is the quoted paragraph
- a margin drag starting level with the quote: the range's anchor is the quoted paragraph
- a triple-click in a quote's gutter: the quoted paragraph is selected
- a word dropped in a quote's gutter: it lands at the start of the quoted paragraph

## Edge cases

- a margin drag from beside a paragraph into a table: the range runs from the paragraph to the
  table
- a drag from a paragraph's text into a table: the same range
  - Miss-analysis: each gesture's lookup had rows of its own at its own points, so no spec ran
    the five at one point, and a gesture with a private copy of the walk was never compared
