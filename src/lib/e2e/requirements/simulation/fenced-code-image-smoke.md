# Feature: Fenced-code + image smoke (note-taking simulation)

The headline biology note typed char-by-char from an empty document, run in
the default (ungated) simulation gate with the screenshot recorder off. It is
the only note that type-builds a fenced code block AND an image through real
gestures, and it previously ran only behind the capture gate — this smoke puts
those two block kinds under the always-on oracle suite on every run.

## Happy paths

- builds the full multi-section note char-by-char — ATX headings, paragraphs
  with bold/italic/code/links, a nested bullet list, an ordered list, a task
  list, a blockquote, an unclosed fenced code block, a thematic break, and an
  image inserted then resized
- end-state equality holds: after the build and every detour, the typed
  document equals the canonical note byte-for-byte (typing ≡ loading)

## Edge cases

- seeded mid-session detours each net to identity before the session
  continues — a small select-and-delete then undo, a copy/paste then undo,
  and a block reorder then undo all restore the byte-exact pre-detour source
- the jump-back edit nets to identity: the typed char is removed and the
  source returns to its pre-detour value even though the caret landed
  mid-document

## User interactions

- typing uses per-character keyboard events; structure markers (`#`, `-`,
  `>`, ` ``` `, `---`) are typed literally and the live parser forms the block
- the jump-back detour repositions with a real pointer click into the first
  top-level block; landing in the wrong block is a hard failure
- image insert gates on the loaded widget before resizing with Shift+Arrow
  steps; the task toggle is a real checkbox click; undo / redo use real
  cross-platform shortcuts around forced batch boundaries

## Error cases

- no console or page errors fire across the whole session
- the live serializer round-trips the current CST at each oracle checkpoint,
  and the nested-state audit finds no desync
- the note's landmark phrases appear in document order once the build ends
- the undo/redo differential restores the exact pre/post source around a
  forced batch boundary, and the transient edit is dropped so the note ends
  clean
