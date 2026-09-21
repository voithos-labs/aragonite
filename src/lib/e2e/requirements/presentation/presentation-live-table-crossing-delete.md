# Feature: live-mode table-crossing deletes clean their stranded runs

A selection crossing the table wall deletes by truncating its prose endpoint in
place, with no join, so the delimiter runs the cut strands (their partner gone
with the deleted range) never reached the live join cleaner and painted as a
literal `**` on screen. The contract is `live-mode.md` § 4.5's: live mode may
drop only bytes the user never saw, checked against what is painted, and the
truncation takes the cleaner's unpaired-run half. Driven on `/test/editor` via
`?presentationMode=live`; the source bridge is what each scenario checks against.

## Happy paths

- select from inside `**bold**` in a paragraph into a table below it, Backspace:
  the kept head shows no stranded delimiter on screen or in the source, and the
  caret sits at the cleaned join

## Edge cases

- source mode: the same gesture keeps the truncation byte-literal, delimiters
  included (pinned by unit tests in `table-aware-delete-live-seam.test.ts`)

## User interactions

- the selection grows by real Shift+Arrow keypresses from a real click, and the
  delete is a real Backspace, because the cleanup lives under the cross-block
  delete dispatch

## Error cases

## Miss analysis

The live-join file pins every prose-to-prose merge across a boundary, where the
cleaner runs; no spec selected across the table wall, which is the one branch
that skipped the cleanup.
