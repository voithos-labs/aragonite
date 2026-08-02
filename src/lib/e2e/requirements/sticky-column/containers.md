# Feature: Sticky column — container traversal, transparent blocks, edge cases

Column memory survives moves into and out of container blocks (blockquote, list), passes through transparent blocks (thematic break), and degrades gracefully in edge conditions (empty blocks, editor blur).

## Happy paths

- ArrowDown through a blockquote's inner paragraph and out the other side preserves the original column
- ArrowDown through a list's items and out to the paragraph below preserves the original column

## Edge cases

- Thematic break is transparent: ArrowDown onto then past `---` preserves the original column in the next paragraph
- Sticky capture in an empty paragraph does not crash; the next ArrowDown lands near the left edge of the target block. The fixture is exactly one empty paragraph between two prose blocks (three newlines), and the block count is asserted — the arm guarded on it instead and skipped itself silently when the count moved
- Editor blur (focus moved outside the editor) resets sticky column; re-focusing and ArrowDown captures fresh from the new caret X
