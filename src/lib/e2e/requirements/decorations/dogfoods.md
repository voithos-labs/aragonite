# Feature: decoration dogfoods, highlight-occurrences + ghost-text

Two reference plugins built on the public API only (`definePlugin`, `setup(ctx)`,
`ctx.onEditor`, `editor.decorations`, `editor.events`): `highlight-occurrences`
marks every whole-word occurrence of the word under the caret (class
`hl-occurrence`, a mark source driven by the selection), and `ghost-text` renders
one in-flow widget, a gray suggestion, at the focused paragraph's end. Together
they show that the mark overlay and the inline-widget render path are reachable by
a plugin author with no internal imports. Scenarios run on
`/test/plugins?seed=hloccur` / `?seed=ghost`.

## Happy paths

- clicking into a word marks all whole-word occurrences across blocks (substrings
  inside longer words are not marked)
- ghost text renders as one in-flow widget at the focused paragraph's end, on the
  focused block only

## User interactions

- moving the caret to another word moves the marks with it; a caret on whitespace
  clears them
- typing an extra occurrence recomputes the marks (the source tracks the document)
- clicking into a paragraph keeps the caret where clicked while the ghost widget
  appears: rebuilding the widget must not steal or shift the caret
- typing at the paragraph end inserts into the source and never captures the
  ghost's text, so `getSource()` stays byte-clean
- typing with the caret at the widget's element-level boundary (no text node after
  the widget at block end) still inserts at the raw offset. This pins the
  `isTyping && !caretIsInTextNode()` widget branch of the edge-policy dispatch,
  which Chromium otherwise drops silently
- ArrowRight at the paragraph's last text offset leaves the block; the zero-width
  widget never traps the caret

## Edge cases

- an empty paragraph (Enter at block end) still shows the ghost widget and keeps
  its caret anchor: the next keystroke lands in the source (the `ensureBr` case)
