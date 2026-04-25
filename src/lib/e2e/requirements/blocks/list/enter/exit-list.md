# Block: List — Enter (exit list on empty item)

Enter on an item whose first paragraph is empty exits the list. Position-aware behavior depends on whether the empty item is the only/first/middle/last item, and whether the item has nested content.

## Exit-list scenarios

- Enter on empty item exits the list:
  - Empty only item: list replaced by empty paragraph
  - Empty first item: deleted, paragraph created before the list
  - Empty middle item: deleted, list splits into two lists with paragraph between
  - Empty last item: deleted, paragraph created after the list
- Enter on item whose first paragraph is empty exits the list, even if the item has nested content:
  - Matching-type nested lists (same ordered/unordered) merge into the surviving list halves as siblings
  - Mismatched-type nested lists (e.g. ordered inside unordered) lift out as a separate top-level block
  - Non-list trailing children (extra paragraphs in a loose item, fenced code, etc.) lift out as separate top-level blocks
  - Order: lifted blocks appear immediately after the new exit paragraph, preserving the document order they had inside the exited item
