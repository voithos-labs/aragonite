# Feature: Inline Editing — Formatting Shortcuts

Keyboard shortcuts that wrap or unwrap selected text with bold/italic markers.

## Formatting shortcuts

- Ctrl+B wraps selected text with \*\* markers
- Ctrl+B on already-bold text removes \*\* markers
- Ctrl+B on a word inside a longer bold run splits the run rather than double-wrapping (regression: the press minted `**text **text2****`; miss-analysis: every unapply scenario aligned the selection with a construct boundary, so the strict sub-range fall-through to the wrap arm went unobserved)
- Ctrl+B over a selection spanning bold runs and plain text bolds it as one run, absorbing the inner markers
- Ctrl+I wraps selected text with \* markers
- Ctrl+I on already-italic text removes \* markers
- Ctrl+B on an inner word flanked by \*\* markers strips the markers rather than double-wrapping

Formatting with no selection is its own concern — see `formatting-at-caret.md`.
