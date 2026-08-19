# Feature: Inline Editing — Editing Formatted Content

Editing inside or around inline formatting; split-created blocks correctly carry inline parsing through.

## Happy paths

- typing after inline formatting preserves it: type at the end of a paragraph ending in a bold span, and of one ending in a code span; both constructs remain intact
- editing does not corrupt inline markers: type at the start of a formatted paragraph, source still has correct ** and * delimiters

## Edge cases

- bold in split-created block renders: Enter to create new block, type **bold**, <strong> element appears (regression: split blocks had no inlineContent)
- heading markers dimmed after # conversion: Enter to create new block, type # prefix, .md-marker span renders with dimmed opacity (regression: markers appeared unstyled)
- character-by-character typing renders bold correctly: typing **bold** one key at a time via keyboard.type() produces <strong> element (regression: double DOM rebuild caused reversed text)

## User interactions

- split paragraph with inline formatting: Enter in middle of formatted paragraph, both halves render correctly
