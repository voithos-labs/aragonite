# Feature: Cross-container clipboard operations

## Happy paths

- Cut with anchor inside blockquote and focus outside: deletes range, start wins
- Cut with anchor outside and focus inside blockquote: deletes range, start wins
- Copy from a paragraph into a quote writes the quote's lines with their markers and the blank line
  between the blocks
- Cut from a paragraph into a nested quote writes every quote level the range covers, each line
  with its own markers
- Copy from inside blockquote to paragraph then paste reproduces text

## Edge cases

- Cross-container cut then undo restores both container structure and content
- Backspace across container boundary merges into the start block's context
- Cut from paragraph across blockquote then undo restores both blocks

## Miss-analysis

- A range ending inside a quote copied without the quote's markers or the blank line before it
  (#815): the one copy row across a quote asserted the document stayed put, never what the clipboard
  held, and every unit row held the quote whole or started in its only child.
