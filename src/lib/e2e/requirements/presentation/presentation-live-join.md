# Feature: live-mode destructive joins (the seam a delete leaves)

A selection in live mode runs over bytes the user cannot see. Deleting from inside `**bold**`
to inside `*italic*` byte-literally leaves `**bo` joined to `alic*`, and both runs print the
moment the block re-renders: the delimiters the mode exists to hide. The contract: a destructive
join drops the runs its cut stranded and the closer and opener it brings back to back, so the
joined text carries no delimiter the user never typed; where the two sides still make one
construct across the join, the construct survives instead. Delete, cut and type-over go through
the same cleanup, and so does the delete half of a paste. Driven on `/test/editor` via
`?presentationMode=live` with real clicks, real Shift-extends and real chords; the source is
what each scenario checks against, since a hidden delimiter and an absent one look identical on
screen.

## Happy paths

- a selection from inside bold to inside italic, deleted with Backspace, leaves the joined text
  with neither `**` nor `*` in the source
- the same selection cut with `Mod+X` leaves the same bytes, and the clipboard carries the source
  slice the selection covered: a copy in live mode yields source bytes, not the visible text
- the same selection typed over inserts the character at the join the cleanup left, with no
  delimiter around it
- a selection from inside a construct in one paragraph into the next joins the two on the same
  terms; once the selection crosses a boundary the extension steps over whole blocks, so the far
  endpoint is a block head, and the case with a construct on both sides is pinned by unit tests
  rather than driven here
- a paste over that selection lands its text at the cleaned join: the cleanup runs in the delete
  half, and the re-parse after the insert fixes up the rest

## Edge cases

- a selection that starts and ends inside the same construct keeps it: its opener and closer meet
  across the join, which is what the user had, so nothing is dropped
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

The split cleanup got its pin in the batch before this one; the join cleanup had none, and the
residue an Enter-then-Backspace left shipped as a known defect for exactly that reason. The
general answer: a gesture that moves a block boundary needs a pin on both directions of the move,
not one.
