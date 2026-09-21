# Feature: Inline Editing: Formatting Shortcuts

Keyboard shortcuts that wrap or unwrap selected text with bold/italic markers.

## Formatting shortcuts

- Ctrl+B wraps selected text with \*\* markers
- Ctrl+B on already-bold text removes \*\* markers
- Ctrl+B on a word inside a longer bold run splits the run rather than double-wrapping (regression: the shortcut wrote `**text **text2****`; miss-analysis: every unapply scenario aligned the selection with a construct boundary, so nothing observed a strict sub-range falling through to the wrap branch)
- Ctrl+B over a selection spanning bold runs and plain text bolds it as one run, absorbing the inner markers
- Ctrl+B over a bold run and the space beside it removes the \*\* markers: a run closes against a word and never whitespace, so a selection reaching past the run by a space alone is still the run's own (miss-analysis: every unapply scenario put both endpoints on the run's own bytes, so none ever gave that coverage check the boundary space the wrap itself leaves outside the delimiters)
- Ctrl+I wraps selected text with \* markers
- Ctrl+I on already-italic text removes \* markers
- Ctrl+B on an inner word flanked by \*\* markers strips the markers rather than double-wrapping

Formatting with no selection is its own concern: see `formatting-at-caret.md`.
