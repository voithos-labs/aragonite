# Feature: Enter at the end of a setext title

The setext underline (`=====` / `-----`) is part of the heading's syntax, trailing
the title rather than being editable content. Enter at (or inside) the title must
keep the whole underline with the heading half: a plain raw cut strands it below,
where `=====` reparses as a junk paragraph and `-----` as a thematic break,
silently demoting the heading. Enter mid-title is a byte rule pinned by
`src/lib/test/tree-operations/setext-split.test.ts`.

## Happy paths

- Enter at the end of a level-1 (`=====`) or level-2 (`-----`) title: the heading keeps its bytes and setext kind, an empty paragraph (never a thematic break) appears below, caret on the empty block

## Edge cases

- the seeded end-caret lands at the content end (before the underline), not at raw end, so the split only exercises the suffix rule from there
- the live tree converges with a reparse of its own serialization after the split (catches a cut that left a block's kind out of step with its raw)
- the empty block below takes a blank-line separator of its own, so the split's bytes reload as two blocks rather than as a heading with a trailing blank line for a suffix

## User interactions

- real click + End + Enter at the title end: same split as the seeded-caret path; typing then lands in the empty block below
