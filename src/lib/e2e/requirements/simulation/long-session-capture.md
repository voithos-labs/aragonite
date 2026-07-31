# Feature: Long-session capture (note-taking simulation)

The full biology-note session driven entirely through real keyboard, mouse, and
clipboard input from an empty document, recording a screenshot + state manifest
at each structural unit for an agentic visual review. Gated behind `SIM_CAPTURE`
so it stays out of the default suite; the same oracle suite that guards the smoke
guards every gesture here.

## Happy paths

- builds a multi-section note from empty char-by-char — ATX headings, paragraphs
  with bold/italic/code/links, bullet + ordered + task lists, a blockquote, a
  fenced code block, a thematic break, and a resized image
- the recorder writes one screenshot + manifest entry per completed structural
  unit (heading, each list, blockquote, code block, image resized), pairing each
  PNG with the source at that moment; the post-build `note-built` and `detour-done`
  checkpoints land too once the list-exit desync (Error cases) no longer throws
- the manifest lands at `test-results/simulation/seed-7/manifest.json`; the run
  directory is seed-derived, so a second run overwrites identically
- end-state equals the canonical note (typing ≡ loading) — asserted once the
  list-exit desync no longer halts the session before the end-state oracle

## Edge cases

- a checkpoint mutates nothing: marking a build boundary leaves the source and
  caret untouched, so the end-state equality oracle still holds
- list exit, ordered-list renumber, task-marker rewrite, and image-resize rewrite
  are all auto-behavior — each gesture resyncs the tracker from observed state
  rather than predicting, so the spine stays deterministic across them
- the jump-back edit nets to identity even though the caret lands mid-document:
  the typed char is removed and the source returns to its pre-detour value before
  the session continues

## User interactions

- typing uses per-character keyboard events; structure markers (`#`, `-`, `>`,
  ` ``` `, `---`) are typed literally and the live parser forms the block
- jump back to edit an earlier section: a real pointer click repositions into the
  first top-level block, the focus block path must equal the target, then a single
  char is typed and backspaced out (a wrong-block landing is a hard failure) — this
  detour runs after the post-build oracles, so the smoke exercises it today and the
  capture reaches it once the list-exit desync clears
- image insert gates on the loaded widget (resize handle visible) before resizing;
  the resize uses Shift+Arrow steps and rewrites the `|width` deterministically
- task toggle uses a real checkbox click; undo / redo use real cross-platform
  shortcuts around a forced batch boundary

## Error cases

- no console or page errors fire across the whole session
- the live serializer round-trips the current CST at each oracle checkpoint
- the undo/redo differential restores the exact pre/post source around a forced
  batch boundary, and the transient edit is dropped so the note ends clean
- `auditBlockListStateConsistency` holds across the whole session, including the
  three list exits the full note walks
