# Feature: Decoration-ops (note-taking simulation)

A loaded-ops session over a document that carries all three kinds of decoration at
content-keyed positions: a `[>…<]` **replace widget**, a `WIDGET`-anchored zero-width
**inline widget**, a `BADGE`-marked **block decoration**, and a typed
**decoded-entity glyph widget**. The standing decoration source (installed under
`?seed=sim`, inert without these sentinels) paints them; the gesture vocabulary
drives the caret, delete and typing behavior each one owns while the simulation's
reference checks (the structured-error and invariant console watcher, the live-CST
round-trip, the nested `BlockListState` audit, and the reparse comparison) run again
after every move. It is the only session where the continuous corruption checks watch
decorations while they are being edited.

Decorations are view-only, so painting them changes no source, CST, or undo state.
Every gesture nets to identity: the replace delete and the widget backspace are undone
and the entity is typed then deleted whole, so the document returns to the loaded bytes.

## Happy paths

- the replace and inline widgets and the block badge paint at their content-keyed
  positions the moment the document loads, before any gesture
- arrow keys walk the caret across a replace widget as one unit: one press from the
  leading edge lands past the whole hidden range, one press back returns to the
  leading edge, and the widget is never selected
- a zero-width inline widget is transparent to the arrow keys: the caret crosses it
  onto the adjacent real byte without selecting it and without changing the source
- Backspace against a replace widget's trailing edge (and Delete against its leading
  edge) selects the widget whole, leaving the hidden bytes byte-identical; a second
  press deletes the whole hidden range as one undo entry; one undo restores it
- Backspace at an inline widget's offset eats the adjacent real byte, rather than
  doing nothing but stripping the widget's DOM; the sentinel word survives, so the
  widget is derived again
- typing a character at a widget's trailing edge inserts into the raw next to it and
  the widget survives, since its content key is untouched; deleting the character
  restores the document
- reordering the badge-decorated block down moves the block decoration to the new
  path, because the badge follows the bytes; undo returns both
- typing `&copy;` mid-prose paints a single glyph widget while the source keeps the
  literal six-byte reference; one Backspace from its trailing edge removes the whole
  reference in one press and one undo entry

## Edge cases

- the first press of a two-press replace delete must not change the source: a silent
  one-byte eat would be invisible corruption, so the test asserts the hidden bytes are
  byte-identical after it rather than trusting the render
- an adjacent insert or delete never dissolves a content-keyed decoration: the
  decoration source derives it again on each per-edit pass, so its count holds across
  the edit
- the block decoration is keyed to content, not a frozen path, so it lands wherever
  the bytes move after a structural reorder

## User interactions

- the caret reaches a widget by a real ArrowRight walk from the block start to the
  target edge, read back through the widget-aware cursor API; the destructive and
  typing keys under test are real key presses
- the block-decoration reorder is a real Alt+ArrowDown after a pointer click; the
  session waits for the reordered source and for the badge to appear on its new block
- the entity reference is typed with real per-character input; the delete walks to its
  trailing edge with real arrow keys, which step over the widget, before the Backspace

## Error cases

- no console, page, or structured editor error fires across the session, including the
  `[invariant:…]` channel. Miss-analysis: the two-press widget delete fired a
  `decorations` warning here because the render pass judged a decoration's range against
  a document one edit newer than the one the decoration source had read; no test paired a
  source with its own document, and the render-side unit suite asserted the wrong blame as
  the contract.
- the live serializer round-trips the current CST, and the live CST matches a reparse of
  its serialization, at every checkpoint
- the nested-state audit finds no `BlockListState` out of sync after any widget edit,
  badge reorder, or entity edit
