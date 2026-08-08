# Feature: live-mode demote-first (Backspace at a heading's content start)

A heading's `## ` is unpainted in live, so the first Backspace a user can aim at it lands on
structure they cannot see. The contract: a kind declaring `contentStartBackspace: 'demote-first'`
gives up its own structural bytes on that press — whichever end it keeps them at — and the merge
cascade takes the second press unchanged. Driven on `/test/editor` via `?presentationMode=live`
with real keystrokes and real clicks; the source and the block's kind are the oracles.

## Happy paths

- `Backspace` at a heading's content start demotes it to a paragraph rather than merging. It
  works at document index 0, where the merge cascade returns early, because the demote sits at
  the command arm rather than inside the merge
- one `Mod+Z` restores the heading whole: the demote is a command, so it owns its undo entry
  instead of joining the typing burst around it
- the SECOND press merges, through the untouched cascade — demote-first delays the merge by one
  press, it does not replace it
- a setext heading gives up its trailing underline on the same press: its structure is a suffix,
  and the kind's content range is what says so

## Edge cases

- an INDENTED heading (`  ## x`) demotes as well: the gate is the kind's content range, which
  skips the indent, so a rewrite anchored on the `#`s would write the block back unchanged and
  lose the press entirely
- a heading opening with a construct (`## **B** head`) demotes at the caret `Home` actually
  leaves, which sits past both hidden runs — the reachable start, not the model's content start
- `Delete` at a setext heading's content end takes nothing: the merge it would reach concatenates
  past the underline and would surface it, so the press is consumed until the join seams keep a
  block's own structure across a merge
- source mode never demotes: a press inside the painted `## ` takes a marker byte, because there
  the markers are on screen and the user aimed at them

## User interactions

- Real keystrokes and real clicks only: the demote sits behind the block-command dispatch, and
  the bound it tests is the caret one the DOM walk reports — a programmatic seat would bypass both
- Assertions read the source and the block kind through the bridge

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)
