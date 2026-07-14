# Feature: decoration dogfoods — highlight-occurrences + ghost-text

Two reference plugins built on public doors only (`definePlugin`, `setup(ctx)`,
`ctx.onEditor`, `editor.decorations`, `editor.events`): `highlight-occurrences`
marks every whole-word occurrence of the word under the caret (class
`hl-occurrence`, a selection-driven mark source), and `ghost-text` renders one
in-flow widget island — a gray suggestion — at the focused paragraph's end.
Together they validate that the mark overlay and the widget-island render path
are reachable by a plugin author with no internal imports. Scenarios run on
`/test/plugins?seed=hloccur` / `?seed=ghost`.

## Happy paths

- clicking into a word marks all whole-word occurrences across blocks (substrings
  inside longer words are not marked)
- ghost text renders as one in-flow island at the focused paragraph's end, on the
  focused block only

## User interactions

- moving the caret to another word moves the marks with it; a caret on whitespace
  clears them
- typing an extra occurrence recomputes the marks (document-tracking provide)
- clicking into a paragraph keeps the caret where clicked while the ghost island
  appears (the island rebuild must not steal or shift the caret)
- typing at the paragraph end inserts into the source and never captures the
  ghost's text — `getSource()` stays byte-clean
- typing with the caret at the island's element-level boundary (no text node
  after the island at block end) still inserts at the raw offset — pins the
  `isTyping && !caretIsInTextNode()` branch of decoration-island-keys, which
  Chromium otherwise drops silently
- ArrowRight at the paragraph's last text offset leaves the block; the zero-width
  island never traps the caret

## Edge cases

- an empty paragraph (Enter at block end) still shows the ghost island and keeps
  its caret anchor: the next keystroke lands in the source (the `ensureBr` case)
