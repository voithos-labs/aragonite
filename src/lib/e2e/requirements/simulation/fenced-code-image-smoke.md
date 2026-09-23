# Feature: Fenced-code + image smoke (note-taking simulation)

The headline biology note typed char-by-char from an empty document, run in
the default (ungated) simulation project with the screenshot recorder off. It
is the only note that builds both a fenced code block and an image by typing
through real gestures, so it puts those two block kinds under the always-on
reference checks on every run.

## Happy paths

- builds the full multi-section note char-by-char: ATX headings, paragraphs
  with bold/italic/code/links, a nested bullet list, an ordered list, a task
  list, a blockquote, an unclosed fenced code block, a thematic break, and an
  image inserted then resized
- end-state equality holds: after the build and every detour, the typed
  document equals the canonical note byte-for-byte (typing ≡ loading)

## Edge cases

- seeded mid-session detours each net to identity before the session
  continues: a small select-and-delete then undo, a copy/paste then undo,
  and a block reorder then undo all restore the byte-exact pre-detour source
- the jump-back edit nets to identity: the typed char is removed and the
  source returns to its pre-detour value even though the caret landed
  mid-document
- seed-gated range interrupt: a live cross-block range meets one interrupting
  gesture and a single printable key, which must land on that gesture's pinned
  outcome. This is the only ungated session whose document holds an image, so it
  is where the widget-click contract meets a real note; the click below the last
  block is correctly withheld here, because an image-only paragraph offers that
  strip of dead space no character position to land on. Contracts in
  `range-interrupt-ops.md`

## User interactions

- typing uses per-character keyboard events; structure markers (`#`, `-`,
  `>`, ` ``` `, `---`) are typed literally and the live parser forms the block
- the jump-back detour repositions with a real pointer click into the first
  top-level block; landing in the wrong block is a hard failure
- the image insert waits for the loaded widget before resizing with Shift+Arrow
  steps; the first task toggle is a real checkbox click and the second a click into
  the item's text followed by Mod+Enter; undo / redo use real cross-platform
  shortcuts around forced batch boundaries

## Error cases

- no console or page errors fire across the whole session
- the live serializer round-trips the current CST at each checkpoint,
  and the nested-state audit finds nothing out of sync
- the note's landmark phrases appear in document order once the build ends
- the undo/redo differential restores the exact pre/post source around a
  forced batch boundary, and the transient edit is dropped so the note ends
  clean
