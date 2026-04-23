# Feature: Select-all clipboard round-trip

## Happy paths

- Ctrl+A twice → Ctrl+C → paste into new block reproduces document content
- Ctrl+A twice → Ctrl+X → removes all content, leaving single empty block

## Edge cases

- Select-all copy on single-block document: paste appends entire block content
- Select-all then paste replaces entire document with clipboard content
- Ctrl+A inside a list item: first press selects the item's content only (ambient marker excluded); second press escalates to whole-document cross-block selection. Marker exclusion happens in the cross-block dispatcher so the escalation counter still increments.
