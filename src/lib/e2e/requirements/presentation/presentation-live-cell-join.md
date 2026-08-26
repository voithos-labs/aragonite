# Feature: live-mode destructive joins inside a table cell

A table cell splices its own bytes and escapes them at the write sink, so its destructive edits
crossed no seam: a live cut or type-over across hidden delimiters pasted the stranded runs into
view (the paste half was fixed first; cut, type-over and selection delete stayed byte-literal).
The contract is the prose surface's: every destructive selection edit in a cell crosses the same
join seam, and the escaping sink runs after it over whatever bytes it wrote. Driven on
`/test/editor` via `?presentationMode=live`; the bridge reports where each gesture put the caret,
and the SOURCE is the oracle.

## Happy paths

- a selection from inside `**bold**` to inside `*it*` cut with `Mod+X` leaves the joined cell
  text with no stranded delimiter in the source, and the clipboard carries the raw slice
- the same selection typed over lands the character at the cleaned seam with no delimiter
  around it
- one `Mod+Z` after the cut restores the original cell bytes

## Edge cases

- source mode is unaffected: the same cut over the same bytes stays byte-literal, delimiters
  included, because there they are painted and the user aimed at them

## User interactions

- The selection every scenario starts from is built by gesture: a click into the cell, an arrow
  walk to the offset strictly inside `**bold**`, then `Shift+ArrowRight` to one strictly inside
  `*it*`. A walk that leaves the cell fails the scenario — a range the caret cannot reach is not
  a range the user can cut
- Every edit is a real chord or keystroke — the seam lives under the cut/beforeinput handlers,
  which programmatic writes would bypass

## Error cases

- zero `[invariant:…]` console fires across every scenario (automatic via the shared e2e fixture)

## Miss analysis

The cell paste seam got its e2e row in the wave that fixed it; the cell's other destructive
edits had neither e2e nor unit pins, so they stayed byte-literal unseen. The generalized answer:
when a seam is added for one gesture of a destructive family, every sibling gesture needs a row
in the same wave.

Those rows then seeded their range through `bridge.setSelection`, so they proved the seam handled
endpoints no gesture was shown to reach: regressing the cell's `ArrowRight` hop boundary to the
cell's content START left all four rows green (and the `cell-keydown-plan` unit table too, which
has no mid-text `ArrowRight` case). The generalized answer: a spec whose subject is a gesture
family seeds its range by gesture — the bridge is a state accessor, not an input device.
