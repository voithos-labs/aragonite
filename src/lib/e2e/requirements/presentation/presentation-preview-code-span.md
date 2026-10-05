# Feature: a code span in a preview mode's focused block

preview-block and preview-inline paint the focused block's markers, and a code span's backticks
are markers like the rest: preview-block shows them with the block's focus, preview-inline with
the caret's construct, and a table cell (which has no per-construct reveal) with the cell's
focus. Painted backticks are bytes on screen, so an arrow steps over each one, and where the
caret sits is where the next byte goes. Driven on `/test/editor` with real clicks and keys; the
source is what each scenario checks.

## Happy paths

- in a paragraph and in a table cell, in both preview modes, a click at the end of `` `cee` ``
  shows the backticks, and one ArrowRight then `X` types past the closing backtick:
  `` `cee`X q ``
- four ArrowLefts from the same click step to before the opening backtick: `` X`cee` ``

## Miss-analysis

- Inline code got a marker family of its own for live mode, and no preview scenario held a code
  span, so nothing saw the family skip the focused block's reveal in preview-block, nor stay
  hidden for good in a preview-inline table cell, which never runs the per-construct reveal.

## User interactions

- real clicks and real keys only; the caret is walked onto its offset with arrows

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e
  fixture)
