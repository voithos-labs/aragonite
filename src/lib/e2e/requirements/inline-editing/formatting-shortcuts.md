# Feature: Inline Editing — Formatting Shortcuts

Keyboard shortcuts that wrap or unwrap selected text with bold/italic markers.

## Formatting shortcuts

- Ctrl+B wraps selected text with \*\* markers
- Ctrl+B on already-bold text removes \*\* markers
- Ctrl+I wraps selected text with \* markers
- Ctrl+I on already-italic text removes \* markers
- Ctrl+B on an inner word flanked by \*\* markers strips the markers rather than double-wrapping

Formatting with no selection is its own concern — see `formatting-at-caret.md`.
