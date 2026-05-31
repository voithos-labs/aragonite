# Feature: Diverse-notes capture (note-taking simulation)

Two longer, more diverse note sessions than the headline biology note, each driven
entirely through real keyboard, mouse, and clipboard input from an empty document
and guarded by the full harness oracle suite. They exist to surface bugs over
constructs the biology note deliberately avoided: dense inline variety (the
feature-tour note) and deep container nesting (the project-plan note). Gated behind
`SIM_CAPTURE` so they stay out of the default suite; each records a screenshot +
state manifest per structural unit for an agentic visual review.

## Happy paths

- feature-tour note builds inline-rich prose char-by-char — ATX H1/H2 sections,
  multiple paragraphs, bold, italic, bold-italic, code spans, several links,
  strikethrough, bare-URL and bare-email autolinks, HTML entities, backslash
  escapes, a trailing-backslash hard line break, plus a bullet list and an ordered
  list; end-state equals the canonical note (typing ≡ loading)
- project-plan note builds structurally-deep content char-by-char — two-level
  nested bullets, an ordered list with a nested ordered sub-item, a mixed
  checked/unchecked task list, a multi-line blockquote, a fenced code block,
  several headings, and a resized image; end-state equals the canonical note
- each session records one screenshot + manifest entry per completed structural
  unit, plus the post-build `note-built` and `detour-done` checkpoints; the
  manifest lands at a seed-derived directory so a second run overwrites identically

## Edge cases

- hard line break round-trips: a paragraph line ending in `\` then Enter then a
  continuation line stays one paragraph (`a\\\nb`) and re-serializes to itself
- HTML entities and backslash escapes survive verbatim — the live parser styles
  them but the source bytes are unchanged on round-trip
- multi-line blockquote continuation: a single Enter inside a quote adds a `> `
  continuation line in the same paragraph rather than splitting a new block
- nested-list cadence: an item is typed at its creation level then indented, and
  the empty trailing item is outdented back to top level before the next item is
  typed — the only tracker-safe nesting shape
- task toggle flips the first checklist item from unchecked to checked via a real
  checkbox click; the resulting `[x]` matches the canonical note

## User interactions

- typing uses per-character keyboard events; structure markers (`#`, `-`, `1.`,
  `**`, `*`, `` ` ``, `~~`, `[`, `>`, ` ``` `) are typed literally and the live
  parser forms the styled spans and blocks
- list nesting uses real Tab / Shift+Tab; the multi-line blockquote uses a real
  Enter-then-type continuation; the image uses a real widget click then Shift+Arrow
  resize
- jump back to edit an earlier section: a real pointer click repositions into the
  first top-level block, the focus block path must equal the target, then a single
  char is typed and backspaced out (a wrong-block landing is a hard failure)
- undo / redo use real cross-platform shortcuts around a forced batch boundary; the
  transient edit is dropped so each note ends in its clean built state

## Error cases

- no console or page errors fire across either whole session
- nested BlockListState stays consistent (`auditBlockListStateConsistency` finds no
  container id/ref desync) at every oracle checkpoint, including across list nesting,
  the multi-line blockquote, and the list exits
- the live serializer round-trips the current CST at each oracle checkpoint
- the undo/redo differential restores the exact pre/post source around a forced
  batch boundary
- both sessions are deterministic: the asserted end-state and captured artifacts are
  identical across repeated runs of the same seed
