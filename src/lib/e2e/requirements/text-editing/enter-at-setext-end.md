# Feature: Enter at the end of a setext title

The setext underline (`=====` / `-----`) is structural chrome that trails the
title, not editable content. Enter at (or inside) the title must keep the whole
underline with the heading half — a plain raw cut strands it below, where
`=====` reparses as a junk paragraph and `-----` as a thematic break, silently
demoting the heading.

## Happy paths

- Enter at the end of a level-1 (`=====`) title: the heading keeps its bytes and setext kind, an empty paragraph appears below, caret on the empty block
- Enter at the end of a level-2 (`-----`) title: same split — no thematic break appears below

## Edge cases

- the seeded end-caret lands at the content end (before the underline), not at raw end — the split only exercises the suffix rule from there
- Enter mid-title: the heading half keeps the underline and setext kind; the tail becomes a paragraph
- the live tree converges with a reparse of its own serialization after the split (catches a cut that left a block's kind stale vs its raw)

## User interactions

- real click + End + Enter at the title end: same split as the seeded-caret path; typing then lands in the empty block below
