# Feature: Text Editing: Forward Delete

Forward Delete merges with the next block when at end-of-block; otherwise deletes the next
character. The merge itself is driven through a list item in `blocks/list/backspace/delete-forward.md`
and its bytes are pinned at the tree level; what stays here is what the key does where no merge
applies.

## Edge cases

- Delete in middle of block deletes the next character (no merge)
- Delete before a thematic break focuses it (whole-block focus), no byte change; a second Delete removes it
- Delete before a non-mergeable heading does not merge; it moves focus to the next block
