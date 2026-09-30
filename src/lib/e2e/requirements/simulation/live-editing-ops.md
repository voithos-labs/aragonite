# Feature: Live-mode editing ops (note-taking simulation)

A loaded-ops session that drives live mode's own editing rules through the
gesture layer. Live is the only mode that hides every content-backed marker
without revealing it, so each rule rewrites bytes the user cannot see. That
makes the source the only thing that can check them, and makes a silent
divergence invisible on screen by construction. Every gesture enters live
through the header toggle (a real click), drives one rule with real keys, and
undoes what it spent, so the whole family nets to identity and the session's
round-trip and nested-state checks run over every step.

## Happy paths

- entering live through the header toggle and leaving again leaves the source
  byte-identical, whatever ran in between
- `Mod+B` over a selected word in live wraps it in `**` immediately (the
  collapsed-caret half of the same chord waits instead and writes nothing), and
  one undo removes the wrap
- `Mod+Shift+X` and `Mod+E`, live's own two chords, wrap the same selection in
  `~~` and a backtick pair on the same terms
- `Backspace` at a construct's trailing content edge takes the last content
  character and leaves the delimiter pair standing
- `Backspace` at a heading's content start demotes the heading to a paragraph
  rather than merging it, and one undo puts the prefix back
- `Enter` inside a bold construct leaves both halves balanced: the split closes
  and reopens the construct instead of cutting the pair open
- a click on a rendered link opens the link card; `Enter` in its field rewrites
  the destination as one undo entry
- a `#` typed onto a fresh line creates a heading whose marker stands over no
  content, and the space and word behind it are predicted keystroke by keystroke
- three backticks typed the same way create a fenced block, and its info string
  lands on the fence line rather than in front of it
- a table header row typed the same way creates nothing while it is being typed,
  so every byte is predicted; the `Enter` that completes it into a grid is what
  creates the table

## Edge cases

- the typed openers are the exception to the one-press rule below: a typed
  run is batched on wall-clock time, so they are undone by however many entries
  the stack actually gained, and byte equality across the whole gesture holds them to it
- every other gesture's undo is asserted as exactly one press: a rule that spent
  two entries fails the gesture rather than silently costing the user two Ctrl+Z.
  Only the note weave (`biology-note`) can go red on the over-spending half:
  this spec's stack never exceeds one entry, so a second undo there has nothing
  to overshoot into. The deep stack a session builds is what makes the press
  count worth asserting
- the caret is placed by a real click and then walked onto its exact offset with
  arrow keys: in live mode a hidden run has no box, so a click's pixel-to-offset
  mapping is approximate while the arrow walk is the caret contract itself
- the switch back to source mode is in a `finally`, so a failing rule still
  leaves the editor in the mode the following checks expect

## User interactions

- real clicks and real keystrokes throughout; the mode itself is entered by
  clicking the header toggle, not by setting the prop
- each mutating step waits for the source to differ from what it was before the
  gesture, never for a marker substring: the fixtures already contain `**`, so a
  substring check would fire before the rule committed

## Error cases

- no console, page, or structured editor error fires across the session
- the live serializer round-trips the current CST after every gesture
- the nested-state audit finds nothing out of sync after any gesture

## Miss-analysis

- The simulation only ever met a block opener as bytes a fixture had loaded, so
  the keystroke path that creates one (the change of kind, and where the next
  byte goes after it) was never driven under the corruption checks. A feature
  reachable only by typing needs a gesture that types it.
