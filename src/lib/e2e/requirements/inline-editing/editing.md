# Feature: Inline Editing — Editing Formatted Content

Editing inside or around inline formatting; split-created blocks correctly carry inline parsing through.

## Happy paths

- typing after inline formatting preserves it: type at end of a bold span, bold remains intact
- source round-trips after editing formatted content: type inside a paragraph with formatting, getSource matches expected
- editing does not corrupt inline markers: type near ** markers, source still has correct ** delimiters

## Edge cases

- bold in split-created block renders: Enter to create new block, type **bold**, <strong> element appears (regression: split blocks had no inlineContent)
- heading markers dimmed after # conversion: Enter to create new block, type # prefix, .md-marker span renders with dimmed opacity (regression: markers appeared unstyled)
- character-by-character typing renders bold correctly: typing **bold** one key at a time via keyboard.type() produces <strong> element (regression: double DOM rebuild caused reversed text)

## User interactions

- click into formatted paragraph and type: click block with bold text, focusBlockEnd, typeText, verify source
- split paragraph with inline formatting: Enter in middle of formatted paragraph, both halves render correctly
