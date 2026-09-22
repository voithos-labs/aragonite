# Feature: Sticky column through a paragraph whose only content is widgets

A run of entity widgets is a paragraph the caret can enter but never sit inside: every position
it can take is a boundary between two widgets, and the browser measures such a position to no
box at all. The column has to survive both halves of that. Arriving, the caret lands on the
widget edge nearest the column instead of falling to the start of the block. Leaving, the column
is read off the widget edge the caret sits on instead of the left edge of the block.

## Happy paths

- ArrowDown into the run from a column past its right end: the caret lands at the run's trailing
  edge, and a typed character appears after the last entity
- ArrowDown into the run from the start of the line above: the caret lands at the run's leading
  edge, and a typed character appears before the first entity
- ArrowDown into the run from a column part-way along the line above: the caret lands on the
  widget edge nearest that column, which is neither end of the run
  - Miss-analysis: the two scenarios above aim at the run's own ends, and a search that always
    answered with the block's first offset satisfied one of them, so neither asked whether the
    column is read at all
- click past the run, then ArrowDown: the caret lands in the paragraph below within one character
  of the last widget's right edge
  - Miss-analysis: the sticky-column specs all walk between blocks made of text, where every
    offset the search reads has a box of its own, so nothing asked what the column reads or
    lands on where the only caret positions sit beside a widget
- ArrowDown through the run and straight out, then ArrowUp back: the caret returns to the column
  it started in, because a run of vertical arrows captures the column once
