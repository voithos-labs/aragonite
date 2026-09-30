# Feature: Select-all clipboard round-trip

## Happy paths

- Ctrl+A twice → Ctrl+C → paste into new block reproduces document content
- Ctrl+A twice → Ctrl+X → removes all content, leaving single empty block

## Edge cases

- Ctrl+A twice → Backspace on a prose-only document: the merged block survives, so the document keeps ≥1 editable block and the user can immediately type into it.
- Select-all copy on a single-block document: paste appends the entire block content. Subsumed by the escalation scenario below, whose first press is the single-block select-all, so it has no fixture of its own here.
- Select-all then paste replaces entire document with clipboard content
- Ctrl+A inside a list item: first press selects the item's content only (the list marker prefix excluded); second press escalates to whole-document cross-block selection. The marker is excluded in the cross-block dispatcher, so the escalation counter still increments.
