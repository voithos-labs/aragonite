# Feature: Container Block Editing — Inner Container+Paragraph Merge

Merging a trailing inner paragraph inside a container (blockquote or list item) into the deepest prose leaf of a preceding inner-sibling container.

## Edge cases

- Backspace at offset 0 of a trailing paragraph inside a blockquote, when the preceding inner sibling is a nested blockquote, merges into the deepest prose leaf of that nested blockquote.

## User interactions

- After the merge (preceding sibling is a nested blockquote), typing inserts at the join point inside the merged leaf — not at the end of the merged container.
- Same behavior when the preceding nested container is two or more levels deep (deepest prose leaf receives the caret regardless of nesting depth).
- Same behavior when the preceding inner sibling is a list inside a blockquote (caret lands at end of the last list item's deepest prose leaf).
- Same behavior when the preceding inner sibling is a list inside a list item (caret lands at end of the last list item's deepest prose leaf).
