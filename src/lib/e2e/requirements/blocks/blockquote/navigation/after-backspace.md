# Feature: Blockquote Navigation — After Backspace

Navigation after Backspace deletes a transient empty inner paragraph.

## After Backspace (delete empty inner paragraph)

- Delete an empty inner paragraph via Backspace; ArrowDown from the preceding paragraph lands on the paragraph that was after the deleted one
- Delete an empty inner paragraph via Backspace; ArrowUp from the succeeding paragraph lands on the paragraph that was before the deleted one
- Regression: same stale-ref hazard as the split case — after merging the empty middle back into its predecessor, ArrowDown from the merge target must traverse correctly to the surviving next child.
