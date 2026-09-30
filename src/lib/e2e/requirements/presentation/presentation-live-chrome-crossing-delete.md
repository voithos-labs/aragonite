# Feature: live-mode deletes across a reserved title row clean their stranded runs

A selection crossing the wall of a container with a reserved title row deletes by
truncating its prose endpoints in place, with no join, so the delimiter runs the
cut strands (their partner gone with the deleted range) never reached the live
join cleaner and painted as a literal `**` on screen. The contract is
`live-mode.md` § 4.5's: live mode may drop only bytes the user never saw, and the
truncation takes the cleaner's unpaired-run half, while the title row's own raw
writes stay byte-literal with the wall left out of the cleaner's view. Driven on
`/test/plugins` (callout seed) switched to live through the bridge; the source
bridge is what each scenario checks against.

## Happy paths

- select from inside `**bold**` in a callout body paragraph out across the
  container wall, Backspace: the kept head shows no stranded delimiter on
  screen or in the source

## Edge cases

- source mode keeps the truncation byte-literal, and an endpoint in the title row
  stays byte-literal even in live mode (both pinned by unit tests in
  `chrome-aware-delete-live-seam.test.ts`)

## User interactions

- the selection grows by real Shift+Arrow keypresses from a real click, and the
  delete is a real Backspace, because the cleanup lives under the cross-block
  delete dispatch

## Error cases

## Miss-analysis

The fix for the table branch pinned its own prose truncations, but no spec
selected across a container wall without a table, which is the sibling branch
that skipped the cleaner in exactly the same way.
