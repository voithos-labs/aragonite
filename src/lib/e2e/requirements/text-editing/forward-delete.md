# Feature: Text Editing — Forward Delete

Forward Delete merges with the next block when at end-of-block; otherwise deletes the next character.

## Edge cases

- Delete at end of block merges with next block (heading absorbs paragraph)
- Delete in middle of block deletes the next character (no merge)
- Delete before a thematic break focuses it (whole-block focus), no byte change; a second Delete removes it
- Delete before a non-mergeable heading does not merge — moves focus to the next block
