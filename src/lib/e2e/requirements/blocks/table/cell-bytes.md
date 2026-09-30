# Feature: a cell edit changes that cell's bytes and nothing else

A table can be spelled lots of ways that all read the same: cells padded or tight, pipes at the ends of a row or not, a delimiter row of `-` or `:---:`. Typing in a cell rewrites the text of that one cell, inside the padding it already had, and every other byte of the table stays as the file had it.

Miss-analysis: every table scenario loaded a table in the editor's own spelling, so the rebuild that respelled the whole table on the first keystroke wrote back the bytes it read and nothing looked wrong.

## Happy paths

- Loading a tight table (`|a|b|` rows, a `|-|:-|` delimiter), clicking a body cell, End, typing: only that cell's text changes in the source, and the source reloads as the tree the editor holds
- The same in the header row: the header cell changes, and the delimiter row and the body rows keep their spelling

## Edge cases

- An over-padded cell (`|  2  |`) keeps its padding on both sides of the typed text

## User interactions

- a real click into the cell, End, then typed keys

## Error cases

- zero `[invariant:…]` console fires (automatic via the shared e2e fixture)
