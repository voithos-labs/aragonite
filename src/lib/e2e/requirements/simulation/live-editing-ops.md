# Feature: Live-mode editing ops (note-taking simulation)

A loaded-ops session that drives live mode's own editing rules through the
gesture layer. Live is the only mode that hides every marker with no reveal, so
each rule rewrites bytes the reader cannot see — which makes the SOURCE the only
oracle for them, and makes a silent divergence invisible on screen by
construction. Every gesture enters live through the header toggle (a real
click), drives one rule with real keys, and closes with the single undo that
rule is contracted to cost, so the whole family nets to identity and the
session's round-trip and nested-state oracles run over every step.

## Happy paths

- entering live through the header toggle and leaving again leaves the source
  byte-identical, whatever ran in between
- `Mod+B` over a selected word in live wraps it in `**` immediately (the
  collapsed-caret half of the same chord pends instead and writes nothing), and
  one undo removes the wrap
- `Mod+Shift+X` and `Mod+E` — live's two new chords — wrap the same selection in
  `~~` and a backtick pair on the same terms
- `Backspace` at a construct's trailing content edge takes the last CONTENT
  character and leaves the delimiter pair standing
- `Backspace` at a heading's content start demotes the heading to a paragraph
  rather than merging it, and one undo puts the prefix back
- `Enter` inside a bold construct leaves BOTH halves balanced — the split closes
  and reopens the construct instead of cutting the pair open
- a click on a rendered link opens the link card; `Enter` in its field rewrites
  the destination as one undo entry

## Edge cases

- every gesture's undo is asserted as exactly ONE press: a rule that spent two
  entries fails the gesture rather than silently costing the user two Ctrl+Z.
  Only the note weave (`biology-note`) can red on the OVER-spending half: this
  spec's stack never exceeds one entry, so a second undo there has nothing to
  overshoot into — the deep stack a session builds is what makes the press count
  load-bearing
- the caret is seated by a real click and then walked onto its exact offset with
  arrows — in live a hidden run has no box, so a click's pixel→offset mapping is
  approximate while the arrow walk is the caret contract itself
- the flip back to source is in a `finally`, so a failing rule still leaves the
  editor in the mode the following oracles expect

## User interactions

- real clicks and real keystrokes throughout; the mode itself is entered by
  clicking the header toggle, not by setting the prop
- each mutating step settles on a SOURCE DELTA against the pre-gesture source,
  never on a marker substring — the fixtures already contain `**`, so a
  containment predicate would fire before the rule committed

## Error cases

- no console, page, or structured editor error fires across the session
- the live serializer round-trips the current CST after every gesture
- the nested-state audit finds no desync after any gesture
