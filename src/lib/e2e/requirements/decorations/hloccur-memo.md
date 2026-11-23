# Feature: highlight-occurrences over a table cell, a code block and the modes

Occurrence marks paint on blocks of prose only (paragraph, heading, table cell: the ones that
read inline Markdown); a fenced code block is not prose and is out of scope. Marks are
view-only, so they survive a presentation-mode switch.

The marks also step aside while you type: a key hides them until the plugin's own typing
pause runs out, a quarter-second after the last character.

Miss-analysis: every occurrence scenario asserted marks after a click and none typed through
one, so "highlighted while you type" was never a scenario anyone wrote down.

Scenarios run on `/test/plugins?seed=hloccur-memo`. Block [0] is a paragraph
(`alpha beta alpha`), [1] a table with `alpha` in a body cell, [2] a fenced code block
containing `alpha`.

## Happy paths

- clicking a word marks every whole-word occurrence across the paragraph and the
  table cell (a cell's editable area paints marks too)
- the occurrence inside the fenced code block is never marked (not a prose block)

## User interactions

- typing a three-character burst with the clock frozen clears the overlays, and advancing
  the clock past the typing pause paints them back on the word the caret now sits in: the
  marks step aside for the burst rather than following it character by character

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
