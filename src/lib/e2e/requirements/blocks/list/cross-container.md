# Block: List — Cross-Container Merge on Backspace

Covers the case where the block before a paragraph is a list and Backspace at offset 0 of the paragraph merges across the container boundary.

## Cross-container merge on Backspace (list prev)

- Flat unordered list + following paragraph + Backspace at offset 0 of the paragraph: merge the paragraph's text into the last list item's last paragraph. Caret lands at the join point.
- Flat ordered list: same behavior. The merge does not change item numbering.
- Nested list: merge recurses into the deepest nested list item's last paragraph.
- Loose list item (multi-paragraph): merge lands in the LAST paragraph of the last list item.
- List inside a blockquote + following paragraph: same rule, two levels of container traversal.
- Deepest leaf is opaque (list item's last child is a fenced code block): fall back to move-focus.

See `container-editing.md` for the shared cross-container merge semantic (the same rule applies when the prev block is a blockquote).
