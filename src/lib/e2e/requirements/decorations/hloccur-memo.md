# Feature: highlight-occurrences: epoch-memoized scan + capability skip

The hardened highlight-occurrences plugin caches its word index against the edit
epoch (the counter bumped once per document change): a caret move re-filters the
cached index without re-scanning, a document change rebuilds it, and the rebuild
re-tokenizes only the leaves whose text moved. Occurrence marks paint on
inline-prose blocks only (paragraph, heading, table cell: the ones with
`supportsInline`); a fenced code block is not prose and is out of scope. Marks are
view-only, so they survive a presentation-mode switch.

The marks also step aside while you type. An edit epoch that arrives with no `edit`
event ahead of it is a keystroke, so the source serves nothing until the typing
burst flushes its batched `input` event a quarter-second after the last character.
The index still rebuilds underneath, which is why the counter scenarios below and
the visible-mark scenario can disagree about what is on screen.

Miss-analysis: every occurrence scenario asserted marks after a click and none
typed through one, so "highlighted while you type" was never a scenario anyone
wrote down, and the counters that did type never looked at the overlays.

Scenarios run on `/test/plugins?seed=hloccur-memo`, whose seed wraps the shipped
`createOccurrenceSource` so it reports the index-rebuild count to
`window.__hloccurScans` and the leaves those rebuilds tokenized to
`window.__hloccurTokenized`. Block [0] is a paragraph (`alpha beta alpha`), [1] a
table with `alpha` in a body cell, [2] a fenced code block containing `alpha`.

## Happy paths

- clicking a word marks every whole-word occurrence across the paragraph and the
  table cell (a cell's editable area paints marks too)
- the occurrence inside the fenced code block is never marked (not a prose block)

## User interactions

- moving the caret to another word re-filters to that word without re-scanning:
  the mark set changes but `window.__hloccurScans` is unchanged
- typing a three-character burst rebuilds the index three times, once per keystroke
  rather than once per typing pause (`__hloccurScans` increases by three): the
  positive control that the cache is not frozen
- each of those rebuilds re-tokenizes only the leaf the keystroke changed
  (`__hloccurTokenized` increases by three, one leaf per rebuild), so the per-keystroke
  scan stays proportional to the edited block rather than to the whole document
- typing that same burst with the clock frozen clears the overlays, and advancing
  the clock past the typing pause paints them back on the word the caret now sits
  in: the marks step aside for the burst rather than following it character by
  character

## Edge cases

- a caret placed inside the fenced code block highlights nothing (a block that is
  not prose is not a valid anchor)
- switching to a live-preview mode (preview-block / preview-inline) keeps the marks
  painted: the caret persists and decorations are view-only, so they paint outside
  `source` mode
- switching to reading mode clears the highlight: the editable area goes inert and
  the caret clears, so a highlight driven by the selection has no anchor. The
  decoration paint path itself still works in reading mode, and `mark-overlay.md`
  covers that
