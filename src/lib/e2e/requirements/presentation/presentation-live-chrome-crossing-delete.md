# Feature: live-mode chrome-crossing deletes clean their stranded runs

A selection crossing a reserved-chrome container's wall deletes by truncating
its prose endpoints in place — no join — so the delimiter runs the cut strands
(their partner gone with the deleted range) never crossed the live join cleaner
and painted as literal `**` on screen. The contract is live-mode.md § 4.5's:
live may drop only bytes the reader never saw, and the truncation takes the
cleaner's unpaired-run half; the chrome child's own raw writes stay
byte-literal, the wall excluded from the cleaner's view. Driven on
`/test/plugins` (callout seed) flipped to live through the bridge; the source
bridge is the oracle.

## Happy paths

- select from inside `**bold**` in a callout body paragraph out across the
  container wall, Backspace: the kept head shows no stranded delimiter on
  screen or in the source

## Edge cases

- source mode keeps the truncation byte-literal, and a chrome endpoint stays
  byte-literal even in live (both unit-pinned in
  `chrome-aware-delete-live-seam.test.ts`)

## User interactions

- the selection grows by real Shift+Arrow presses from a real click; the delete
  is a real Backspace — the seam lives under the cross-block delete dispatch

## Error cases

## Miss analysis

The table branch's fix pinned its own prose truncations, but no spec selected
across the chrome wall without a table — the sibling branch that skipped the
cleaner identically.
