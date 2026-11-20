# Feature: a cut into a block whose opening stays

A range from a divider under a paragraph that runs on into a titled callout's title, or into a
table's rows, takes the divider and paragraph whole and keeps the block's opening: the title row's
name or the table's header. A cut holds the gap above that opening, since its paste goes back
there. Fixture: the `/test/plugins` harness, both modes; a selection from the divider's start, then
the keys.

## Happy paths

- A cut into a titled tip's title, then Mod+V: the document comes back as it was
- A cut into a table's first row, then Mod+V: the document comes back as it was, one table

## User interactions

- A cut into a titled tip's title, then a letter: the letter opens a paragraph above the tip
- A cut into a table's first row, then a letter: the letter opens a paragraph above the table

## Miss-analysis

- Every cut row that entered a block entered an untitled row or a fence, whose first line holds no
  text, so none showed the cut resting on a title or a header, where Mod+V flattened the blocks into
  the title or split the table.
