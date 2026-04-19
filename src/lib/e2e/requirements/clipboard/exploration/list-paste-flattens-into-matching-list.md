# Clipboard Exploration: List Paste Flattens Into Matching List

When the clipboard contains a list and the paste target is an empty list item whose outer list is the same kind (both ordered or both unordered), the pasted list's items flatten into the outer list — replacing the empty item — rather than nesting as a sub-list inside it. This is the classic markdown-editor "list round-trip" expectation (Obsidian, Typora, VS Code markdown all behave this way).

## Happy paths

- 3-item ordered list, select items 1-2, Ctrl+C+V: original 3-item structure restored (round-trip).
- 2-item ordered list, select all, Ctrl+C+V: original 2-item structure restored.
- Unordered list round-trip: same behavior as ordered.
- Pre-staged clipboard of list content, paste over cross-block selection of entire target list: pasted items flatten at the outer level.

## Edge cases

- Ordered → unordered (mismatched kinds): current behavior falls back to nested paste. The flatten-on-match rule only fires for matching kinds.
- Non-empty target list-item: current behavior is nested paste. The flatten rule only fires when the target's immediate container-child (the empty list-item from a preceding cross-block delete, or any pre-emptied item) has no non-whitespace content.
