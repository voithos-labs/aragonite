# Feature: A range removal keeps an ordered list's numbering

A range that takes items out of an ordered list renumbers the items after it, from where the
removal was. The items above it keep their numbers. The count steps by 0 when the list's first two
numbers match, and by 1 otherwise. A list that loses its first item keeps its old first number on
the item that now leads it. The source holds the new numbers, so a reload shows the same list.

## Happy paths

- `8. aa / 9. bb / 10. cc / 11. dd`, a range from inside `bb` to the start of `cc`, Delete: the
  source reads `8. aa / 9. bcc / 10. dd`, and the items show 8, 9, 10, in source and live mode.
- The same range and Backspace, or Cut: the same bytes and numbers.
- The same range and a typed `Z`, or a pasted `Z`: `8. aa / 9. bZcc / 10. dd`, numbered 8, 9, 10.
- A list of `1.`s, the same range and Delete or Cut: `1. aa / 1. bcc / 1. dd`. A list of `0.`s
  keeps its `0.`s the same way.

## Edge cases

- A range from inside a paragraph above the list into `bb`, Delete: the paragraph takes `bb`'s
  tail and the one item left reads `8. cc`, keeping the list's start, in source and live mode.
- A range from inside a code block above `9. a / 10. bbb / 11. c` into `bbb`, Delete: the item
  keeps its marker and now leads the list, so it reads `9. bb / 10. c`, never `10. bb / 9. c`
  (the unit row in `src/lib/test/range-edit/ordered-renumber.test.ts`).

## User interactions

- The range inside the list is made with Shift and the arrow keys from a caret placed in `bb`;
  the one from the paragraph above is a Shift+click into it from a caret in `bb`.

Miss-analysis: every cross-block fixture started its list at 1 or cut no middle item, where a
removal that renumbers nothing still reads as consecutive. Later, every fixture counted up by 1,
where a renumber that always steps by 1 writes the bytes the author wrote, and no row ended a
removal inside an item from above the list.
