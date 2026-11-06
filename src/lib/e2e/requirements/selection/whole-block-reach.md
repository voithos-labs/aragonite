# Feature: how far a drag reaches into a tall block it takes whole

A block with no positions inside it (a table of contents, an equation, a diagram) joins a drag's
range as a unit. A mouse's drag takes it once the pointer crosses its centre line from the
anchor's side, and a finger's once it's a line past the block's edge, if that comes first: on a
phone a table of contents can be most of the screen, and the finger covers what's under it.
Shown on the page with plugins, at a phone's width.

## Happy paths

- A mouse drag down from a paragraph a line into a tall outline leaves it out of the range, and
  past its centre line takes it in.
- A mouse drag down out of a table does the same, like every other drag.
  - Miss-analysis: the cell drag had no join rule at all and took the outline at its edge; the
    centre-line rows only dragged from text and only onto short blocks.
- A finger's end handle on a word dragged a line past a tall outline's edge takes the outline in.
  - Miss-analysis: the join rule was only exercised with a mouse on blocks a couple of lines
    tall, where the middle is a line away anyway.
