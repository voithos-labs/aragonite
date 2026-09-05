# Feature: live-mode destructive joins (the seam a delete leaves)

A selection in live mode runs over bytes the reader cannot see. Deleting from inside `**bold**`
to inside `*italic*` byte-literally leaves `**bo` joined to `alic*`, and both runs print the
moment the block re-renders — the delimiters the mode exists to hide. The contract: a destructive
join DROPS the runs its cut stranded and the closer/opener pair it brings back to back, so the
joined text carries no delimiter the reader never typed; where the two sides still make one
construct across the seam, the construct survives instead. Delete, cut and type-over take the
same seam, and so does a paste's delete half. Driven on `/test/editor` via
`?presentationMode=live` with real clicks, real Shift-extends and real chords; the SOURCE is the
oracle, since a hidden delimiter and an absent one look identical on screen.

## Happy paths

- a selection from inside bold to inside italic, deleted with Backspace, leaves the joined text
  with neither `**` nor `*` in the source
- the same selection cut with `Mod+X` leaves the same bytes, and the clipboard carries the SOURCE
  slice the selection covered — live copy yields source bytes, not the visible text
- the same selection typed over inserts the character at the seam the cleanup left, with no
  delimiter around it
- a selection from inside a construct in one paragraph into the next joins the two on the same
  terms; once the selection crosses a boundary the extend walks whole blocks, so the far endpoint
  is a block head and the two-sided cross-block case is unit-pinned rather than driven here
- a paste over that selection lands its text at the cleaned seam: the cleanup runs in the delete
  half, and the re-parse that follows the insert settles the rest

## Edge cases

- a selection that starts and ends inside the SAME construct keeps it: its opener and closer meet
  across the seam, which is what the reader had, so nothing is dropped
- a selection over plain text is untouched by the mode: the same bytes go, and no rewrite runs
- one `Mod+Z` restores the original block, bytes identical

## User interactions

- Real clicks and real `Shift+Arrow` extends only: the interception lives under `beforeinput`, and
  a programmatic selection would not produce the native input event it claims
- Cut and paste are real `Mod+X` / `Mod+V` chords, never programmatic clipboard writes
- Undo is a real `Mod+Z`

## Error cases

- source mode is unaffected: the same gesture over the same bytes leaves both stranded runs on
  screen, because there the delimiters are painted and the user aimed at them
- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)

## Miss analysis

The split seam got its pin in the wave before this one; the JOIN seam had none, and the residue an
Enter-then-Backspace left shipped as a known defect for exactly that reason. The generalized
answer: a gesture that moves a block boundary needs a pin on both directions of the move, not one.
