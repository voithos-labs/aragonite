# Feature: Enter at a soft line break inside a paragraph

A paragraph holding a soft break renders as two visual lines, and the caret at
the end of the first one sits ON the break — the same document position as the
start of the second line, reached by a different key. Enter there must split the
paragraph in two, keeping every line below the caret.

## Happy paths

- Enter with the caret at the end of a soft-broken paragraph's first line: two paragraphs, the second holding the lines that followed the caret
- Enter with the caret at the start of the second line: the same two paragraphs, since it is the same document position

## Edge cases

- the split's bytes reload as the two blocks the tree holds, so the second paragraph survives a remount
- a three-line paragraph split on its first break keeps BOTH following lines in the second half

## User interactions

- real click + End + Enter at the first line's end, then typing: the typed text lands at the head of the second paragraph, which still holds the line it inherited

## Miss-analysis

- Every Enter spec seeded a single-line block or cut mid-word, so none ever handed the split an offset that landed on a line ending. `enter-at-setext-end` came closest and pinned the opposite end of the same axis — that the seeded caret was NOT at raw end.
