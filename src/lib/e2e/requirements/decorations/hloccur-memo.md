# Feature: highlight-occurrences — epoch-memoized scan + capability skip

The hardened highlight-occurrences plugin memoizes its word index on the edit
epoch: a caret move re-filters the cached index (no re-scan), an edit rebuilds it.
Occurrence marks paint on inline-prose surfaces only (paragraph, heading, table
cell — `supportsInline`); a fenced code block is a non-prose leaf and out of scope.
Marks are view-only, so they survive a presentation-mode flip.

Scenarios run on `/test/plugins?seed=hloccur-memo`, whose seed installs an
observability wrapper over the shipped `createOccurrenceSource` that publishes the
index-rebuild count to `window.__hloccurScans`. Block [0] is a paragraph
(`alpha beta alpha`), [1] a table with `alpha` in a body cell, [2] a fenced code
block containing `alpha`.

## Happy paths

- clicking a word marks every whole-word occurrence across the paragraph and the
  table cell (the cell surface paints marks)
- the occurrence inside the fenced code block is never marked (non-prose leaf)

## User interactions

- moving the caret to another word re-filters to that word without re-scanning:
  the mark set changes but `window.__hloccurScans` is unchanged
- typing an edit bumps the epoch, so the index does rebuild (`__hloccurScans`
  increases) — the positive control that the memo is not frozen

## Edge cases

- a caret placed inside the fenced code block highlights nothing (a non-prose leaf
  is not a valid anchor)
- flipping to a live-preview mode (preview-block / preview-inline) keeps the marks
  painted: the caret persists and decorations are view-only, so they paint outside
  `source` mode
- flipping to reading mode clears the highlight: the surface goes inert and the
  caret clears, so the selection-driven highlight has no anchor (the decoration
  paint path itself still works in reading — mark-overlay coverage owns that)
