# Feature: Container Block Editing — Inner Container+Paragraph Merge

Merging a trailing inner paragraph inside a blockquote into the deepest prose leaf of a preceding nested container.

## Edge cases

- Backspace at offset 0 of a trailing paragraph inside a blockquote, when the preceding inner sibling is a nested blockquote, merges into the deepest prose leaf of that nested blockquote.
