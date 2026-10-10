# Feature: Inline Editing, Formatting Shortcuts

Keyboard shortcuts that wrap or unwrap selected text with bold/italic markers.

## Formatting shortcuts

- Ctrl+B wraps selected text with \*\* markers
- Ctrl+B on already-bold text removes \*\* markers
- Ctrl+B over a bold run and the space beside it removes the \*\* markers: a run closes against a word and never whitespace, so a selection reaching past the run by a space alone is still the run's own (miss-analysis: every unapply scenario put both endpoints on the run's own bytes, so none ever gave that coverage check the boundary space the wrap itself leaves outside the delimiters)
- Ctrl+I wraps selected text with \* markers
- Ctrl+I on already-italic text removes \* markers
- Ctrl+B on an inner word flanked by \*\* markers strips the markers rather than double-wrapping

Formatting with no selection is its own concern: see `formatting-at-caret.md`.

## Pinned below the browser

These call the toggle function directly in `test/core/inline/format-toggle-coverage.test.ts`, with no editor:

- a selection inside a longer bold run splits the run rather than double-wrapping (`test/core/inline/format-toggle-coverage.test.ts`)
- a selection spanning bold runs and plain text bolds as one run, absorbing the inner markers (`test/core/inline/format-toggle-coverage.test.ts`)
