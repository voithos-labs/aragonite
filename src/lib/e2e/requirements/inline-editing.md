# Feature: Inline Editing

Editing within blocks that have inline formatting (bold, italic, code, links).

## Happy paths
- bold text renders with <strong>: loading **bold** produces a <strong> element
- italic text renders with <em>: loading *italic* produces an <em> element
- inline code renders with markers: loading `code` shows backtick markers and code content
- link renders with <a>: loading [text](url) produces an <a> element

## Edge cases
- bold in split-created block renders: Enter to create new block, type **bold**, <strong> element appears (regression: split blocks had no inlineContent)
- heading markers dimmed after # conversion: Enter to create new block, type # prefix, .md-marker span renders with dimmed opacity (regression: markers appeared unstyled)
- typing after inline formatting preserves it: type at end of a bold span, bold remains intact
- source round-trips after editing formatted content: type inside a paragraph with formatting, getSource matches expected
- editing does not corrupt inline markers: type near ** markers, source still has correct ** delimiters
- nested formatting renders: **bold *and italic*** produces nested strong/em elements
- character-by-character typing renders bold correctly: typing **bold** one key at a time via keyboard.type() produces <strong> element (regression: double DOM rebuild caused reversed text)

## Formatting shortcuts
- Ctrl+B wraps selected text with ** markers
- Ctrl+B on already-bold text removes ** markers
- Ctrl+I wraps selected text with * markers
- Ctrl+I on already-italic text removes * markers
- Formatting shortcuts with no selection are no-ops

## User interactions
- click into formatted paragraph and type: click block with bold text, focusBlockEnd, typeText, verify source
- split paragraph with inline formatting: Enter in middle of formatted paragraph, both halves render correctly
