# Feature: live-mode table-crossing deletes clean their stranded runs

A selection crossing the table wall deletes by truncating its prose endpoint in
place — no join — so the delimiter runs the cut strands (their partner gone with
the deleted range) never crossed the live join cleaner and painted as literal
`**` on screen. The contract is live-mode.md § 4.5's: live may drop only bytes
the reader never saw, verified by the painter, and the truncation takes the
cleaner's unpaired-run half. Driven on `/test/editor` via
`?presentationMode=live`; the source bridge is the oracle.

## Happy paths

- select from inside `**bold**` in a paragraph into a table below it, Backspace:
  the kept head shows no stranded delimiter on screen or in the source, and the
  caret sits at the cleaned seam

## Edge cases

- source mode: the same gesture keeps the truncation byte-literal, delimiters
  included (unit-pinned in `table-aware-delete-live-seam.test.ts`)

## User interactions

- the selection grows by real Shift+Arrow presses from a real click; the delete
  is a real Backspace — the seam lives under the cross-block delete dispatch

## Error cases

## Miss analysis

The live-join pins all crossed prose→prose merges, where the cleaner runs; no
spec selected across the table wall, the one branch that skipped the seam.
