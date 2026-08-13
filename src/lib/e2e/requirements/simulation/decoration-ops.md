# Feature: Decoration-ops (note-taking simulation)

A loaded-ops session over a document that carries all three decoration tiers at
content-keyed positions: a `[>…<]` **replace island**, a `WIDGET`-anchored
zero-width **widget island**, a `BADGE`-marked **block decoration**, and a typed
**decoded-entity atomic widget**. The standing island source (installed under
`?seed=sim`, inert without these sentinels) paints them; the gesture vocabulary
drives the caret / delete / typing surface each owns while the simulation's oracle
stack — structured error + invariant-console watcher, live-CST round-trip, nested
BlockListState audit, parse convergence — re-checks after every move. This is the
first time the continuous corruption net drives the decoration INTERACTION surface;
before it, the island-editing and block-decoration gestures were scripted-e2e only.

Decorations are view-only, so painting changes no source, CST, or undo state. Every
gesture nets to identity — the replace delete and the widget backspace undo, the
entity is typed then deleted whole — so the document returns to the loaded bytes.

## Happy paths

- the replace / widget islands and the block badge paint at their content-keyed
  positions the moment the document loads, before any gesture
- arrows walk the caret across a replace island as one atomic unit: one press from
  the leading edge lands past the whole hidden range, one press back returns to the
  leading edge, and the island is never selected
- a zero-width widget island is transparent to arrows: the caret crosses it onto the
  adjacent real byte without selecting it and without changing the source
- Backspace against a replace island's trailing edge (and Delete against its leading
  edge) selects the island whole, leaving the hidden bytes byte-identical; a second
  press deletes the whole hidden range as one undo entry; one undo restores it
- Backspace at a widget island's offset eats the adjacent real byte (never a no-op
  stripping only the island DOM); the sentinel word survives, so the island re-derives
- typing a character at an island's trailing edge inserts into raw adjacent to it and
  the island survives (its content key is untouched); deleting the character restores
- reordering the badge-decorated block down carries the block decoration to the new
  path (the badge follows the bytes); undo returns both
- typing `&copy;` mid-prose materializes an atomic glyph widget while the source keeps
  the literal six-byte reference; a single atomic Backspace from its trailing edge
  removes the whole reference in one press and one undo entry

## Edge cases

- the first press of a two-press replace delete must NOT change the source — a silent
  one-byte eat would be invisible corruption, so the survival is asserted with teeth
- an adjacent insert or delete never dissolves a content-keyed decoration: the source
  re-derives it each per-edit pass, so its count holds across the edit
- the block decoration is keyed to content, not a frozen path, so it lands wherever
  the bytes move after a structural reorder

## User interactions

- island caret placement uses a real ArrowRight walk from the block start to the
  target edge, read back through the widget-aware cursor surface; the destructive and
  typing keys under test are real key presses
- the block-decoration reorder is a real Alt+ArrowDown after a pointer click; the
  session settles on the source permutation and the badge appearing at the new host
- the entity reference is typed with real per-character input; its atomic delete walks
  to the trailing edge with real arrows (widget-aware step-over) before the Backspace

## Error cases

- no console, page, or structured editor error fires across the session, including the
  `[invariant:…]` channel. Miss-analysis: the two-press island delete fired a
  `decorations` warning here because the render pass judged a decoration's range against
  a document one edit newer than the one the source read; no test paired a source with
  its own document, and the render-side unit suite asserted the misplaced blame as the
  contract.
- the live serializer round-trips the current CST, and the live CST converges with a
  reparse of its serialization, at every checkpoint
- the nested-state audit finds no BlockListState desync after any island edit, badge
  reorder, or entity edit
