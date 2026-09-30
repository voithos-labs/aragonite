# Feature: Inserting markdown from a table cell

## Edge cases

- `insertMarkdown('> ')` with the caret in an empty cell: a quote lands after the table with a
  blank line on each side, and the document reloads as the blocks on screen
  - Miss-analysis: no spec inserted blocks from a cell, and every structural paste pin ended its
    clipboard in a line ending, so the open last line that took the next block's blank line was
    never drawn
- `insertMarkdown('> quoted\n')` from the same cell: the same shape, with the quote's text
