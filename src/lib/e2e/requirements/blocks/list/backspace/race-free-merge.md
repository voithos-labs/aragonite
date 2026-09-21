# Block: List, Race-Free Merge after Backspace

Regression coverage for the J3 merge race: a character typed straight after Backspace used to land on the block as it was before the merge.

## Regression: race-free merge after Backspace

- Backspace at start of non-first item followed by immediate `typeText`: the typed character lands at the merge boundary (`AlphaZBeta`, for one), not on the block as it stood before the merge. The nested upward delegation in `mergeWithPrevious` was not awaited, which left a window where the typed character raced the merge.
- Same scenario for nested-list items: Backspace at start of an inner-list item followed by typing puts the character at the merge boundary inside the parent item's nested list.
