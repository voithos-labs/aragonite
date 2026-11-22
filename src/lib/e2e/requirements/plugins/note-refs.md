# Feature: footnote references drawn as widgets on `depends`

An `inline()` widget (`routes/test/plugins/note-refs`) declares `depends` with the labels each
top-level block references, and draws each `[^label]` as the order its label first appears. The
seed references `b`, then `a` and `b` again, then holds a plain paragraph and one with a tag
(`inline-follow.md`). Live mode.

Miss-analysis: a new surface; no inline widget could read the rest of the document before.

## Happy paths

- Loading the page: the first block's reference reads 1, the second block's read 2 and 1.

## Edge cases

- `[^a] ` typed at the start of the first block: the second block, never typed in, now reads 1
  and 2, and the first block reads 1 and 2.

## User interactions

- A letter typed in the plain paragraph asks one block, and the numbers stand.
