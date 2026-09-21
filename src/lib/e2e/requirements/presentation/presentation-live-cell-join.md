# Feature: live-mode destructive joins inside a table cell

A table cell splices its own bytes and escapes them where it writes them, so its destructive
edits went through no cleanup of the join: a live cut or type-over across hidden delimiters left
the stranded runs in view. Paste was fixed first, while cut, type-over and selection delete
stayed byte-literal. The contract is the one prose blocks already have: every destructive
selection edit in a cell goes through the same join cleanup, and the escaping step runs after it
over whatever bytes it wrote. Driven on `/test/editor` via `?presentationMode=live`; the bridge
reports where each gesture put the caret, and the source is what each scenario checks against.

## Happy paths

- a selection from inside `**bold**` to inside `*it*` cut with `Mod+X` leaves the joined cell
  text with no stranded delimiter in the source, and the clipboard carries the raw slice
- the same selection typed over lands the character at the cleaned join with no delimiter
  around it
- one `Mod+Z` after the cut restores the original cell bytes

## Edge cases

- source mode is unaffected: the same cut over the same bytes stays byte-literal, delimiters
  included, because there they are painted and the user aimed at them

## User interactions

- The selection every scenario starts from is built by gesture: a click into the cell, arrow
  steps to the offset strictly inside `**bold**`, then `Shift+ArrowRight` to one strictly inside
  `*it*`. Stepping out of the cell fails the scenario, since a range the caret cannot reach is
  not a range the user can cut
- Every edit is a real chord or keystroke: the cleanup lives under the cut and beforeinput
  handlers, which programmatic writes would bypass

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)

## Miss analysis

The cell's paste cleanup got its e2e row in the same batch that fixed it; the cell's other
destructive edits had neither e2e nor unit pins, so they stayed byte-literal unseen. The general
answer: when a cleanup step is added for one gesture of a destructive family, every sibling
gesture needs a row in the same batch.

Those rows then built their range through `bridge.setSelection`, so they proved the cleanup
handled endpoints no gesture was shown to reach: moving the cell's `ArrowRight` hop boundary
back to the cell's content start left all four rows green, and the `cell-keydown-plan` unit
table too, which has no mid-text `ArrowRight` case. The general answer: a spec whose subject is
a family of gestures builds its range by gesture, because the bridge reads state and is not an
input device.
