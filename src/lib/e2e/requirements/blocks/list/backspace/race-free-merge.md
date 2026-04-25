# Block: List — Race-Free Merge after Backspace

Regression coverage for the J3 merge race: the typed marker used to land on a stale pre-merge block when Backspace was followed immediately by a typed character.

## Regression — race-free merge after Backspace

- Backspace at start of non-first item followed by immediate `typeText`: the typed character lands at the merge boundary (e.g., `AlphaZBeta`), not on a stale pre-merge block. Pre-fix, the nested upward-delegation in `mergeWithPrevious` was unawaited, leaving a window where the typed marker raced the merge.
- Same scenario for nested-list items: Backspace at start of an inner-list item followed by typing produces the marker at the merge boundary inside the parent item's nested list.
