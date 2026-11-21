# Feature: footnote numbers painted from `paintDepends`

A paint (`routes/test/plugins/note-numbers`, the guide's recipe) declares `paintDepends` with the
labels each top-level block references, and marks each `[^label]` with the order its label first
appears. The seed references `b`, then `a` and `b` again, then holds a plain paragraph.

Miss-analysis: no real browser had run `paintDepends`; its rows ran in jsdom.

## Happy paths

- Loading the page: the first block's reference reads 1, the second block's read 2 and 1.

## Edge cases

- `[^a] ` typed at the start of the first block: the second block, never typed in, now reads 1
  and 2, and the first block reads 1 and 2.

## User interactions

- A letter typed in the plain paragraph: only that block is painted again, and the numbers stand.
