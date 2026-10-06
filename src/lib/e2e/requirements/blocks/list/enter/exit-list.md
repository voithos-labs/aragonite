# Block: List, Enter (exit list on empty item)

Enter on an item whose first paragraph is empty exits the list. What happens next depends on whether the empty item is the only, first, middle or last item, and on whether the item has nested content.

## Exit-list scenarios

- Enter on empty item exits the list:
  - Empty only item: list replaced by empty paragraph
  - Empty first item: deleted, paragraph created before the list
  - Empty middle item: deleted, list splits into two lists with paragraph between
  - Empty last item: deleted, paragraph created after the list
- Enter on item whose first paragraph is empty exits the list, even if the item has nested content. The new paragraph takes the item's line, and everything the item held follows it in the order it read:
  - Matching-type nested lists (same ordered/unordered) give their items to the list's level, and the list's later items join them when they come last
  - Mismatched-type nested lists (e.g. ordered inside unordered) lift out as a separate top-level block
  - Non-list trailing children (extra paragraphs in a loose item, fenced code, etc.) lift out as separate top-level blocks, each keeping the blank line above it, so a line typed into the new paragraph doesn't run into them
- An empty item holding a sublist, a paragraph and a second sublist: the new paragraph sits where the item's line was, and the sublist items, the paragraph and the second sublist's items follow in the order they read (miss-analysis: every exit row gave the item one kind of child, so nothing read a sublist item against a paragraph after it)

## State consistency

- After exiting a list, the surviving list's `BlockListState` stays in step: `auditBlockListStateConsistency()` reports no violation (the reused ListBlock component's `innerBlockRefs` must not keep a stale trailing entry for the removed item)
